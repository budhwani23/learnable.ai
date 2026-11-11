"""
Direct Cerebras (OpenAI-compatible) chat calls, including images.

qwen-3.8-27b on Cerebras reads images sent as OpenAI-style ``image_url`` parts
(base64 data URLs). It does NOT accept audio, video, PDF files or URLs, so those
stay on Gemini.

Cerebras sits behind Cloudflare, which rejects some HTTP clients without a
User-Agent ("error code: 1010"), so every call sends one.
"""
import base64
import logging
import os
import time
from typing import Any, Dict, Iterable, List, Optional, Union

import requests

logger = logging.getLogger(__name__)

CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
DEFAULT_CEREBRAS_MODEL = "qwen-3.8-27b"
USER_AGENT = os.getenv("CEREBRAS_USER_AGENT", "learnable-ai/1.0 (+https://learnable.ai)")

Content = Union[str, List[Dict[str, Any]]]


class CerebrasError(RuntimeError):
    """A Cerebras request failed (after retries for transient errors)."""


def is_configured() -> bool:
    return bool(os.getenv("CEREBRAS_API_KEY"))


def headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['CEREBRAS_API_KEY']}",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
    }


def image_part(data: bytes, mime_type: str = "image/png") -> Dict[str, Any]:
    """An OpenAI-style image content part with the image inlined as a data URL."""
    encoded = base64.b64encode(data).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}}


def text_and_images(prompt: str, images: Iterable[Union[bytes, tuple]]) -> List[Dict[str, Any]]:
    """Build message content: the prompt followed by images (bytes, or (bytes, mime))."""
    parts: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    for img in images:
        data, mime = img if isinstance(img, tuple) else (img, "image/png")
        parts.append(image_part(data, mime))
    return parts


_TRANSIENT = (429, 500, 502, 503, 504)


def complete(payload: Dict[str, Any], *, timeout: Optional[int] = None, attempts: int = 4) -> Dict[str, Any]:
    """
    POST an OpenAI-style chat completion payload to Cerebras (non-streaming) and return
    the raw response JSON. Retries 429/5xx and network errors with backoff.
    """
    if not is_configured():
        raise CerebrasError("Missing CEREBRAS_API_KEY in environment")
    url = f"{os.getenv('CEREBRAS_BASE_URL', CEREBRAS_BASE_URL)}/chat/completions"
    timeout = timeout or int(os.getenv("CEREBRAS_TIMEOUT", "120"))
    last_err = "unknown error"
    for i in range(max(1, attempts)):
        try:
            resp = requests.post(url, headers=headers(), json=payload, timeout=timeout)
        except requests.RequestException as e:  # network / timeout: transient
            last_err = f"network error: {e}"
        else:
            if resp.status_code < 400:
                return resp.json()
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
            if resp.status_code not in _TRANSIENT:
                break
        if i < attempts - 1:
            delay = min(30, 2 * 2 ** i)
            logger.warning("Cerebras request failed (%s); retrying in %ss", last_err[:120], delay)
            time.sleep(delay)
    raise CerebrasError(f"Cerebras request failed: {last_err}")


def chat(
    content: Content,
    *,
    system: Optional[str] = None,
    json_mode: bool = False,
    max_tokens: Optional[int] = None,
    timeout: Optional[int] = None,
    attempts: int = 4,
    model: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
) -> str:
    """
    One chat completion on Cerebras. ``content`` is a string or a list of
    OpenAI content parts (text / image_url). Returns the answer text (the model's
    hidden reasoning is not included). Retries 429/5xx and network errors.

    ``reasoning_effort`` ("low" | "medium" | "high") caps qwen's hidden reasoning.
    qwen's reasoning counts against max tokens: on long tasks (e.g. writing a whole
    Manim scene) it can use every token and return an empty answer with
    finish_reason "length". That case is retried once with low effort and a larger
    limit, and raises CerebrasError rather than silently returning "".
    """
    if not is_configured():
        raise CerebrasError("Missing CEREBRAS_API_KEY in environment")
    messages: List[Dict[str, Any]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": content})
    payload: Dict[str, Any] = {
        "model": model or os.getenv("CEREBRAS_MODEL", DEFAULT_CEREBRAS_MODEL),
        "messages": messages,
        "max_completion_tokens": max_tokens or int(os.getenv("CEREBRAS_MAX_TOKENS", "16000")),
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    data = complete(payload, timeout=timeout, attempts=attempts)
    choice = data["choices"][0]
    answer = (choice["message"].get("content") or "").strip()
    if not answer and choice.get("finish_reason") == "length":
        logger.warning("Cerebras reasoning used all %s tokens with no answer; retrying with low effort",
                       payload["max_completion_tokens"])
        payload["reasoning_effort"] = "low"
        payload["max_completion_tokens"] = max(payload["max_completion_tokens"] * 2, 32000)
        choice = complete(payload, timeout=timeout, attempts=attempts)["choices"][0]
        answer = (choice["message"].get("content") or "").strip()
        if not answer:
            raise CerebrasError("The model ran out of tokens before answering")
    return answer
