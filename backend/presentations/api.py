# presentations/api.py
"""OpenAI-compatible image endpoint used by the Presenton sidecar for slide images.

Presenton (IMAGE_PROVIDER=openai_compatible) calls
    POST /api/presentations/image-proxy/v1/images/generations
    Authorization: Bearer <PRESENTON_IMAGE_PROXY_KEY>
    {"model": ..., "prompt": ..., "n": 1, "size": "1024x1024"}
and reads data[0].b64_json. Images are generated on Amazon Bedrock
(see core/bedrock_images.py).
"""
import base64
import hmac
import logging
import os
import time
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError
from ninja import Router, Schema
from ninja.security import HttpBearer

from core.bedrock_images import ImageFilteredError, ImageGenerationError, get_image_service

logger = logging.getLogger(__name__)
router = Router()


class ProxyKeyAuth(HttpBearer):
    def authenticate(self, request, token):
        expected = os.getenv("PRESENTON_IMAGE_PROXY_KEY", "")
        if expected and hmac.compare_digest(token.encode(), expected.encode()):
            return "presenton"
        return None


class ImageRequest(Schema):
    prompt: str
    model: Optional[str] = None
    n: int = 1
    size: Optional[str] = None


class ImageItem(Schema):
    b64_json: str
    revised_prompt: Optional[str] = None


class ImageResponse(Schema):
    created: int
    data: list[ImageItem]


class ErrorBody(Schema):
    error: dict


@router.post(
    "/image-proxy/v1/images/generations",
    auth=ProxyKeyAuth(),
    response={200: ImageResponse, 400: ErrorBody, 502: ErrorBody},
)
def generate_images(request, payload: ImageRequest):
    if not payload.prompt.strip():
        return 400, {"error": {"message": "prompt is required", "type": "invalid_request_error"}}
    n = max(1, min(payload.n, 4))
    service = get_image_service()
    items = []
    try:
        for _ in range(n):
            image = service.generate(payload.prompt, size=payload.size)
            items.append({"b64_json": base64.b64encode(image.data).decode("ascii")})
    except ImageFilteredError as exc:
        return 400, {"error": {"message": str(exc), "type": "content_policy_violation"}}
    except (ImageGenerationError, ClientError, BotoCoreError) as exc:
        logger.exception("Bedrock image generation failed (model=%s)", service.model_id)
        return 502, {"error": {"message": f"Image generation failed: {exc}", "type": "upstream_error"}}
    return 200, {"created": int(time.time()), "data": items}
