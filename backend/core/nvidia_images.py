# core/nvidia_images.py
"""Text-to-image generation with Black Forest Labs FLUX on NVIDIA's hosted API.

Uses FLUX Klein through build.nvidia.com (https://ai.api.nvidia.com/v1/genai/...).
Configure with env vars:

    NVIDIA_API_KEY        required (nvapi-...)
    NVIDIA_IMAGE_MODEL    default flux-3-image-klein
    NVIDIA_FLUX_STEPS     default 4 (Klein is distilled; ~2s per image)
    NVIDIA_IMAGE_TIMEOUT  seconds, default 120
"""
import base64
import os
from dataclasses import dataclass

import requests

DEFAULT_MODEL = "flux-3-image-klein"
API_URL = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/{model}"

# Aspect ratios we map OpenAI-style sizes onto (long edge is always 1024).
_ASPECT_RATIOS = {
    "1:1": 1.0, "16:9": 16 / 9, "9:16": 9 / 16, "21:9": 21 / 9, "9:21": 9 / 21,
    "3:2": 3 / 2, "2:3": 2 / 3, "4:3": 4 / 3, "3:4": 3 / 4, "5:4": 5 / 4, "4:5": 4 / 5,
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


def dimensions_for_ratio(ratio: str) -> tuple[int, int]:
    """Width/height for FLUX: long edge 1024, both multiples of 64."""
    w_r, h_r = (int(x) for x in ratio.split(":"))
    if w_r >= h_r:
        return 1024, max(64, round(1024 * h_r / w_r / 64) * 64)
    return max(64, round(1024 * w_r / h_r / 64) * 64), 1024


def _mime(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


class NvidiaImageService:
    def __init__(self, model_id: str | None = None, api_key: str | None = None, session=None):
        self.model_id = model_id or os.getenv("NVIDIA_IMAGE_MODEL", DEFAULT_MODEL)
        self.api_key = api_key if api_key is not None else os.getenv("NVIDIA_API_KEY", "")
        self.steps = int(os.getenv("NVIDIA_FLUX_STEPS", "4"))
        self.timeout = int(os.getenv("NVIDIA_IMAGE_TIMEOUT", "120"))
        self.session = session or requests

    def generate(self, prompt: str, size: str | None = None) -> GeneratedImage:
        prompt = (prompt or "").strip()
        if not prompt:
            raise ValueError("prompt is required")
        if not self.api_key:
            raise ImageGenerationError("NVIDIA_API_KEY is not set")
        width, height = dimensions_for_ratio(aspect_ratio_for_size(size))
        try:
            resp = self.session.post(
                API_URL.format(model=self.model_id),
                headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"},
                json={"prompt": prompt[:2000], "width": width, "height": height,
                      "seed": 0, "steps": self.steps},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ImageGenerationError(f"NVIDIA request failed: {exc}") from exc
        if not resp.ok:
            raise ImageGenerationError(f"NVIDIA {resp.status_code}: {resp.text[:300]}")
        payload = resp.json()
        # Response shape: {"artifacts": [{"base64": "...", "finishReason": "SUCCESS", "seed": 0}]}
        for art in payload.get("artifacts") or []:
            reason = str(art.get("finishReason") or "SUCCESS").upper()
            if "FILTER" in reason or "CONTENT" in reason:
                raise ImageFilteredError(f"Image blocked by content filter: {reason}")
            if reason not in ("SUCCESS", "STOP"):
                raise ImageGenerationError(f"Image generation failed: {reason}")
            if art.get("base64"):
                data = base64.b64decode(art["base64"])
                return GeneratedImage(data=data, mime_type=_mime(data), model_id=self.model_id)
        raise ImageGenerationError("Model returned no image")


def get_image_service() -> NvidiaImageService:
    """Service built from current env (cheap; no client state to share)."""
    return NvidiaImageService()
