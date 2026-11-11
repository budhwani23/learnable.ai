"""
OpenAI-compatible chat endpoint for Presenton's slide text, backed by Cerebras.

Presenton (LLM=custom, CUSTOM_LLM_URL=http://<app>/api/presentations/llm-proxy/v1)
calls

    GET  /api/presentations/llm-proxy/v1/models
    POST /api/presentations/llm-proxy/v1/chat/completions      (always stream=true)
    Authorization: Bearer <PRESENTON_IMAGE_PROXY_KEY>

Why not let Presenton call Cerebras itself (LLM=cerebras)? Its streaming client
occasionally ends up with a cut-off or empty JSON slide ("Unterminated string ...",
"LLM did not return any content") and then fails the whole deck. Here each call goes
to Cerebras without streaming, rate limits are retried with backoff, concurrency is
capped (Presenton writes all slides at once, which trips the tokens-per-minute limit),
and JSON answers are checked and re-asked before they are returned, as one SSE chunk
when Presenton asked for a stream.
"""
import json
import logging
import os
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from django.http import HttpResponse, JsonResponse
from ninja.router import Router

from core import cerebras
from .image_proxy import ProxyKeyAuth

logger = logging.getLogger(__name__)

router = Router(auth=ProxyKeyAuth())

# Fields passed through to Cerebras; anything else (provider-specific extras such as
# enable_thinking, stream_options) is dropped.
_PASSTHROUGH = ("messages", "response_format", "tools", "tool_choice", "temperature", "top_p",
                "stop", "seed", "max_completion_tokens", "parallel_tool_calls", "reasoning_effort")
JSON_ATTEMPTS = int(os.getenv("PRESENTON_LLM_JSON_ATTEMPTS", "3"))
_slots = threading.BoundedSemaphore(int(os.getenv("PRESENTON_LLM_CONCURRENCY", "3")))
SLOT_WAIT = int(os.getenv("PRESENTON_LLM_SLOT_WAIT", "240"))  # seconds


def _model() -> str:
    return os.getenv("CEREBRAS_MODEL", cerebras.DEFAULT_CEREBRAS_MODEL)


def _error(status: int, message: str, kind: str) -> JsonResponse:
    return JsonResponse({"error": {"message": message, "type": kind}}, status=status)


@router.get("/v1/models")
def list_models(request):
    return {"object": "list", "data": [{"id": _model(), "object": "model", "owned_by": "cerebras"}]}


def _cerebras_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    payload = {k: body[k] for k in _PASSTHROUGH if k in body}
    payload["model"] = _model()
    # qwen reasons before it answers, and the reasoning counts against the token limit.
    # Presenton's limits are sized for the answer alone, so a small limit leaves a cut-off
    # or empty answer (finish_reason=length): never go below CEREBRAS_MAX_TOKENS.
    requested = body.get("max_completion_tokens") or body.get("max_tokens") or 0
    payload["max_completion_tokens"] = max(int(requested), int(os.getenv("CEREBRAS_MAX_TOKENS", "16000")))
    logger.debug("Slide text request: requested max tokens %s", requested)
    fmt = payload.get("response_format")
    if isinstance(fmt, dict) and fmt.get("type") == "json_schema":
        # Cerebras' strict mode needs additionalProperties:false on every object, which
        # Presenton's schemas don't set. Ask non-strictly and validate the JSON here.
        schema = dict(fmt.get("json_schema") or {})
        schema["strict"] = False
        payload["response_format"] = {**fmt, "json_schema": schema}
    return payload


def _wants_json(payload: Dict[str, Any]) -> bool:
    fmt = payload.get("response_format")
    return isinstance(fmt, dict) and fmt.get("type") in ("json_schema", "json_object")


def _clean_json(text: str) -> Optional[str]:
    """The answer as compact JSON text, or None when it is empty / not valid JSON."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[4:] if text.lower().startswith("json") else text
    try:
        return json.dumps(json.loads(text), ensure_ascii=False)
    except (ValueError, TypeError):
        return None


def _complete(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Cerebras completion; JSON answers are checked and re-asked when cut off or empty."""
    attempts = JSON_ATTEMPTS if _wants_json(payload) else 1
    for attempt in range(1, attempts + 1):
        data = cerebras.complete(payload)
        message = data["choices"][0]["message"]
        if not _wants_json(payload) or message.get("tool_calls"):
            return data
        cleaned = _clean_json(message.get("content") or "")
        if cleaned is not None:
            message["content"] = cleaned
            return data
        logger.warning("Cerebras returned empty/invalid JSON for a slide (attempt %s/%s, finish=%s, %s chars)",
                       attempt, attempts, data["choices"][0].get("finish_reason"),
                       len(message.get("content") or ""))
    raise cerebras.CerebrasError("The model kept returning incomplete JSON")


def _sse(data: Dict[str, Any]) -> HttpResponse:
    """Re-shape a chat.completion as an OpenAI stream: one content chunk, one finish chunk."""
    choice = data["choices"][0]
    message = choice.get("message") or {}
    base = {"id": data.get("id") or f"chatcmpl-{uuid.uuid4().hex}", "object": "chat.completion.chunk",
            "created": data.get("created") or int(time.time()), "model": data.get("model") or _model()}
    delta: Dict[str, Any] = {"role": "assistant", "content": message.get("content") or ""}
    if message.get("tool_calls"):
        delta["tool_calls"] = [{**call, "index": i} for i, call in enumerate(message["tool_calls"])]
    chunks: List[Dict[str, Any]] = [
        {**base, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
        {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": choice.get("finish_reason") or "stop"}],
         "usage": data.get("usage")},
    ]
    body = "".join(f"data: {json.dumps(c, ensure_ascii=False)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return HttpResponse(body, content_type="text/event-stream")


@router.post("/v1/chat/completions")
def chat_completions(request):
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        return _error(400, "Request body must be JSON", "invalid_request_error")
    if not isinstance(body, dict) or not body.get("messages"):
        return _error(400, "messages is required", "invalid_request_error")
    if not cerebras.is_configured():
        return _error(503, "CEREBRAS_API_KEY is not set on the app", "server_error")

    payload = _cerebras_payload(body)
    if not _slots.acquire(timeout=SLOT_WAIT):
        return _error(429, "Too many slide requests at once; retry shortly", "rate_limit_error")
    try:
        data = _complete(payload)
    except cerebras.CerebrasError as exc:
        msg = str(exc)
        logger.error("Slide text request failed: %s", msg[:300])
        if "HTTP 4" in msg and "HTTP 429" not in msg:
            return _error(400, msg, "invalid_request_error")
        return _error(503, msg, "server_error")  # the client retries 503
    finally:
        _slots.release()

    if body.get("stream"):
        return _sse(data)
    data["model"] = data.get("model") or _model()
    return JsonResponse(data)
