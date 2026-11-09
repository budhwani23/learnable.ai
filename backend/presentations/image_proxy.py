"""
OpenAI-compatible image endpoint for Presenton, backed by Gemini with model fallback.

Presenton's built-in Gemini image provider hard-codes one model. Instead we point
its "openai_compatible" image provider at this endpoint:

    POST /api/presentations/image-proxy/v1/images/generations
    Authorization: Bearer <PRESENTON_IMAGE_PROXY_KEY>
    {"model": "...", "prompt": "...", "n": 1, "size": "1024x1024"}

and try each model in PRESENTATION_IMAGE_MODELS in order. Default chain:
  nvidia:flux-3-image-klein   NVIDIA API (build.nvidia.com), skipped without NVIDIA_API_KEY
  gemini-3.1-flash-image      Gemini (needs a billed key; free tier has 0 image quota)
  gemini-3.1-flash-lite-image
  -> neutral placeholder so the deck still completes
Response follows the OpenAI Images API shape: {"created", "data": [{"b64_json"}]}.
"""
import base64
import hmac
import logging
import os
import time
from typing import List, Optional

import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types
from ninja import Schema
from ninja.router import Router
from ninja.security import HttpBearer

load_dotenv()
logger = logging.getLogger(__name__)

DEFAULT_MODELS = "nvidia:flux-3-image-klein,gemini-3.1-flash-image,gemini-3.1-flash-lite-image"
NVIDIA_GENAI_URL = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/{model}"
GEMINI_RATIOS = ("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")


class ProxyKeyAuth(HttpBearer):
    def authenticate(self, request, token: str):
        expected = os.getenv("PRESENTON_IMAGE_PROXY_KEY", "")
        if expected and hmac.compare_digest(token, expected):
            return "presenton"
        return None


router = Router(auth=ProxyKeyAuth())


class ImageRequest(Schema):
    prompt: str
    model: Optional[str] = None
    n: int = 1
    size: Optional[str] = None


def _models() -> List[str]:
    return [m.strip() for m in os.getenv("PRESENTATION_IMAGE_MODELS", DEFAULT_MODELS).split(",") if m.strip()]


def _aspect_ratio(size: Optional[str]) -> Optional[str]:
    """Map an OpenAI size like '1536x1024' to the closest Gemini aspect ratio."""
    try:
        w, h = (float(x) for x in (size or "").lower().split("x"))
    except ValueError:
        return None
    target = w / h
    return min(GEMINI_RATIOS, key=lambda r: abs(float(r.split(":")[0]) / float(r.split(":")[1]) - target))


def _nvidia_size(ratio: Optional[str]) -> tuple[int, int]:
    """Width/height for FLUX: long edge 1024, both multiples of 64."""
    w_r, h_r = (int(x) for x in (ratio or "1:1").split(":"))
    if w_r >= h_r:
        return 1024, max(64, round(1024 * h_r / w_r / 64) * 64)
    return max(64, round(1024 * w_r / h_r / 64) * 64), 1024


def _generate_nvidia(model: str, prompt: str, ratio: Optional[str]) -> bytes:
    """Black Forest Labs FLUX via NVIDIA's hosted API (build.nvidia.com)."""
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise ValueError("NVIDIA_API_KEY is not set")
    width, height = _nvidia_size(ratio)
    resp = requests.post(
        NVIDIA_GENAI_URL.format(model=model),
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        json={"prompt": prompt[:2000], "width": width, "height": height, "seed": 0,
              "steps": int(os.getenv("NVIDIA_FLUX_STEPS", "4"))},
        timeout=int(os.getenv("NVIDIA_IMAGE_TIMEOUT", "120")),
    )
    if not resp.ok:
        raise ValueError(f"NVIDIA {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    # NVIDIA genai image responses: {"artifacts": [{"base64": ..., "finishReason": ...}]}
    for art in data.get("artifacts") or []:
        if art.get("base64"):
            if (art.get("finishReason") or "SUCCESS").upper() not in ("SUCCESS", "STOP"):
                raise ValueError(f"NVIDIA finishReason={art.get('finishReason')}")
            return base64.b64decode(art["base64"])
    for key in ("image", "b64_json"):
        if data.get(key):
            return base64.b64decode(data[key])
    raise ValueError(f"NVIDIA returned no image (keys: {sorted(data)[:8]})")


def _generate_with(client: genai.Client, model: str, prompt: str, ratio: Optional[str]) -> bytes:
    if model.startswith("nvidia:"):
        return _generate_nvidia(model.split(":", 1)[1], prompt, ratio)
    cfg = {"response_modalities": ["IMAGE"]}
    if ratio:
        cfg["image_config"] = types.ImageConfig(aspect_ratio=ratio)
    resp = client.models.generate_content(model=model, contents=prompt,
                                          config=types.GenerateContentConfig(**cfg))
    parts = getattr(resp, "parts", None)
    if not parts and getattr(resp, "candidates", None):
        content = getattr(resp.candidates[0], "content", None)
        parts = getattr(content, "parts", None) if content else None
    for part in parts or []:
        data = getattr(getattr(part, "inline_data", None), "data", None)
        if data:
            return base64.b64decode(data) if isinstance(data, str) else data
    raise ValueError(f"{model} returned no image")


@router.post("/v1/images/generations")
def generate_image(request, body: ImageRequest):
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(api_version="v1beta"))
    ratio = _aspect_ratio(body.size)
    errors = []
    for model in _models():
        try:
            image = _generate_with(client, model, body.prompt, ratio)
            logger.info("Slide image generated with %s", model)
            return {"created": int(time.time()), "model": model,
                    "data": [{"b64_json": base64.b64encode(image).decode()}]}
        except Exception as e:  # try the next (cheaper / less loaded) model
            logger.warning("Image model %s failed, trying fallback: %s", model, str(e)[:300])
            errors.append(f"{model}: {str(e)[:300]}")

    # Presenton fails the whole deck when an image errors, so end the chain with a
    # neutral placeholder (e.g. on a free-tier key, where image models have 0 quota).
    if os.getenv("PRESENTATION_IMAGE_PLACEHOLDER", "true").lower() in ("1", "true", "yes"):
        logger.warning("All image models failed; using placeholder. %s", " | ".join(errors)[:500])
        return {"created": int(time.time()), "model": "placeholder",
                "data": [{"b64_json": base64.b64encode(_placeholder_png(ratio)).decode()}]}
    return router.api.create_response(
        request, {"error": {"message": "All image models failed: " + " | ".join(errors)[:800]}},
        status=502,
    )


def _placeholder_png(ratio: Optional[str]) -> bytes:
    """A soft emerald gradient PNG (no imaging library needed)."""
    import struct
    import zlib
    w_r, h_r = (int(x) for x in (ratio or "16:9").split(":"))
    width = 640
    height = max(1, int(width * h_r / w_r))
    rows = bytearray()
    for y in range(height):
        t = y / max(1, height - 1)
        r, g, b = (int(a + (bb - a) * t) for a, bb in ((236, 209), (253, 250), (245, 229)))
        rows += b"\x00" + bytes((r, g, b)) * width

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))
