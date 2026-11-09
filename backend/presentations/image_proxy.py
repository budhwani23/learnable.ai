"""
OpenAI-compatible image endpoint for Presenton slide images, backed by Amazon Bedrock.

Presenton (IMAGE_PROVIDER=openai_compatible) calls

    POST /api/presentations/image-proxy/v1/images/generations
    Authorization: Bearer <PRESENTON_IMAGE_PROXY_KEY>
    {"model": "...", "prompt": "...", "n": 1, "size": "1024x1024"}

and reads data[0].b64_json. Images come from BEDROCK_IMAGE_MODEL (default Stability
Stable Image Core, see core/bedrock_images.py). Presenton fails the whole deck when one
image errors, so a failed or content-filtered image falls back to a neutral placeholder
(PRESENTATION_IMAGE_PLACEHOLDER=false turns that off).
"""
import base64
import hmac
import logging
import os
import time
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError
from ninja import Schema
from ninja.router import Router
from ninja.security import HttpBearer

from core.bedrock_images import ImageFilteredError, ImageGenerationError, aspect_ratio_for_size, get_image_service

logger = logging.getLogger(__name__)


class ProxyKeyAuth(HttpBearer):
    def authenticate(self, request, token: str):
        expected = os.getenv("PRESENTON_IMAGE_PROXY_KEY", "")
        if expected and hmac.compare_digest(token.encode(), expected.encode()):
            return "presenton"
        return None


router = Router(auth=ProxyKeyAuth())


class ImageRequest(Schema):
    prompt: str
    model: Optional[str] = None
    n: int = 1
    size: Optional[str] = None


def _placeholders_enabled() -> bool:
    return os.getenv("PRESENTATION_IMAGE_PLACEHOLDER", "true").lower() in ("1", "true", "yes")


def _error(request, status: int, message: str, kind: str):
    return router.api.create_response(request, {"error": {"message": message, "type": kind}}, status=status)


@router.post("/v1/images/generations")
def generate_image(request, body: ImageRequest):
    if not body.prompt.strip():
        return _error(request, 400, "prompt is required", "invalid_request_error")
    n = max(1, min(body.n, 4))
    service = get_image_service()
    items = []
    try:
        for _ in range(n):
            image = service.generate(body.prompt, size=body.size)
            items.append({"b64_json": base64.b64encode(image.data).decode("ascii")})
        return {"created": int(time.time()), "model": service.model_id, "data": items}
    except (ImageFilteredError, ImageGenerationError, ClientError, BotoCoreError) as exc:
        filtered = isinstance(exc, ImageFilteredError)
        if _placeholders_enabled():
            logger.warning("Slide image failed (model=%s); using placeholder: %s", service.model_id, str(exc)[:300])
            png = base64.b64encode(_placeholder_png(aspect_ratio_for_size(body.size))).decode("ascii")
            return {"created": int(time.time()), "model": "placeholder", "data": [{"b64_json": png}] * n}
        if filtered:
            return _error(request, 400, str(exc), "content_policy_violation")
        logger.exception("Bedrock image generation failed (model=%s)", service.model_id)
        return _error(request, 502, f"Image generation failed: {exc}", "upstream_error")


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
