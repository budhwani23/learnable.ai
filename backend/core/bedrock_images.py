# core/bedrock_images.py
"""Text-to-image generation on Amazon Bedrock (Stability AI models).

Default model is Stable Image Core: the cheapest serverless (on-demand)
text-to-image model on Bedrock. Stability models are only offered in us-west-2,
so that is the default Region. Override with env vars:

    BEDROCK_IMAGE_MODEL   default stability.stable-image-core-v1:1
                          (also: stability.sd3-5-large-v1:0, stability.stable-image-ultra-v1:1)
    BEDROCK_IMAGE_REGION  default us-west-2
    AWS_PROFILE           optional named profile (e.g. "learnable"); otherwise the
                          default credential chain is used (env keys, IAM role, ...)
"""
import base64
import json
import os
import threading
from dataclasses import dataclass

import boto3
from botocore.config import Config

DEFAULT_MODEL = "stability.stable-image-core-v1:1"
DEFAULT_REGION = "us-west-2"

# Aspect ratios accepted by the Stability text-to-image models on Bedrock.
_ASPECT_RATIOS = {
    "1:1": 1.0, "16:9": 16 / 9, "9:16": 9 / 16, "21:9": 21 / 9, "9:21": 9 / 21,
    "3:2": 3 / 2, "2:3": 2 / 3, "5:4": 5 / 4, "4:5": 4 / 5,
}


class ImageGenerationError(Exception):
    """The model ran but did not return a usable image."""


class ImageFilteredError(ImageGenerationError):
    """The prompt or output was blocked by the model's content filter."""


@dataclass
class GeneratedImage:
    data: bytes
    mime_type: str
    model_id: str


def aspect_ratio_for_size(size: str | None) -> str:
    """Map an OpenAI-style "WxH" size to the closest supported aspect ratio."""
    try:
        w, h = (int(x) for x in (size or "").lower().split("x", 1))
        target = w / h
    except (ValueError, ZeroDivisionError):
        return "1:1"
    return min(_ASPECT_RATIOS, key=lambda k: abs(_ASPECT_RATIOS[k] - target))


class BedrockImageService:
    def __init__(self, model_id: str | None = None, region: str | None = None, client=None):
        self.model_id = model_id or os.getenv("BEDROCK_IMAGE_MODEL", DEFAULT_MODEL)
        self.region = region or os.getenv("BEDROCK_IMAGE_REGION", DEFAULT_REGION)
        if client is None:
            session = boto3.Session(region_name=self.region)  # honours AWS_PROFILE
            client = session.client(
                "bedrock-runtime",
                config=Config(
                    retries={"max_attempts": 4, "mode": "adaptive"},
                    connect_timeout=10,
                    read_timeout=90,
                ),
            )
        self.client = client

    def generate(self, prompt: str, size: str | None = None, output_format: str = "png") -> GeneratedImage:
        prompt = (prompt or "").strip()
        if not prompt:
            raise ValueError("prompt is required")
        body = {
            "prompt": prompt[:10000],
            "aspect_ratio": aspect_ratio_for_size(size),
            "output_format": output_format,
        }
        response = self.client.invoke_model(
            modelId=self.model_id,
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        payload = json.loads(response["body"].read())
        reasons = [r for r in (payload.get("finish_reasons") or []) if r]
        if reasons:
            if any("filter" in str(r).lower() for r in reasons):
                raise ImageFilteredError(f"Image blocked by content filter: {reasons}")
            raise ImageGenerationError(f"Image generation failed: {reasons}")
        images = payload.get("images") or []
        if not images:
            raise ImageGenerationError("Model returned no image")
        return GeneratedImage(
            data=base64.b64decode(images[0]),
            mime_type=f"image/{'jpeg' if output_format == 'jpeg' else output_format}",
            model_id=self.model_id,
        )


_service: BedrockImageService | None = None
_lock = threading.Lock()


def get_image_service() -> BedrockImageService:
    """Shared, lazily created service (boto3 clients are thread safe)."""
    global _service
    if _service is None:
        with _lock:
            if _service is None:
                _service = BedrockImageService()
    return _service
