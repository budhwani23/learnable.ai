"""
Shared input handling for long-running generators (explainer videos, slide decks):
validate + save the student's upload at request time, then extract plain text
from it (or from text / a YouTube URL) inside the background worker.
"""
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from django.core.files import File
from ninja.files import UploadedFile

from constants import (
    ALLOWED_AUDIO_EXTENSIONS, ALLOWED_DOCUMENT_EXTENSIONS, ALLOWED_VIDEO_EXTENSIONS,
)
from core.gemini import GeminiService, get_text_service
from learning.learning_service import LearningService
from utils.media_processor import MediaProcessor
from utils.youtube import get_youtube_transcript, is_youtube_url

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED = {
    "audio": ALLOWED_AUDIO_EXTENSIONS,
    "video": ALLOWED_VIDEO_EXTENSIONS,
    "document": ALLOWED_DOCUMENT_EXTENSIONS,
}


class SourceError(Exception):
    """Raised when the student's input can't be turned into text."""


def describe_input(
    text: str,
    audio_file: Optional[UploadedFile],
    video_file: Optional[UploadedFile],
    document_file: Optional[UploadedFile],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Validate the request input. Returns (spec, error). `spec` holds source_type,
    source_label and either the text or the upload to save with `save_upload`.
    """
    for kind, f in (("audio", audio_file), ("video", video_file), ("document", document_file)):
        if f:
            ext = os.path.splitext(f.name or "")[1].lower()
            if ext not in ALLOWED[kind]:
                return None, f"Unsupported {kind} format. Allowed: {', '.join(ALLOWED[kind])}"
            if f.size > MAX_UPLOAD_BYTES:
                return None, "File size exceeds the 50MB limit."
            return {"source_type": kind, "source_label": os.path.basename(f.name)[:200],
                    "upload": f, "ext": ext}, None
    text = (text or "").strip()
    if text:
        if is_youtube_url(text):
            return {"source_type": "youtube", "source_label": text, "text": text}, None
        return {"source_type": "text", "source_label": text[:80] + ("..." if len(text) > 80 else ""),
                "text": text}, None
    return None, "No content provided. Please enter text, a YouTube URL, or upload a file."


def save_upload(spec: Dict[str, Any], job_dir: Path) -> Dict[str, Any]:
    """Persist the upload (if any) into the job dir. Returns fields to store on the job."""
    if "upload" not in spec:
        return {"text": spec["text"]}
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    input_path = input_dir / f"source{spec['ext']}"
    with open(input_path, "wb") as out:
        for chunk in spec["upload"].chunks():
            out.write(chunk)
    return {"input_path": str(input_path)}


_gemini: Optional[GeminiService] = None


def _services():
    global _gemini
    if _gemini is None:
        _gemini = GeminiService(model_name="gemini-3-flash-preview", temperature=0.7)
    text = get_text_service()
    return MediaProcessor(_gemini, text), LearningService(_gemini, text)


def extract_source_text(job: Dict[str, Any]) -> str:
    """Turn a job's input (text / YouTube URL / saved upload) into plain text."""
    source_type = job["source_type"]
    media_processor, learning_service = _services()

    if source_type == "text":
        text = job["text"]
    elif source_type == "youtube":
        text, error = get_youtube_transcript(job["text"])
        if not text:
            # No transcript available -> Gemini watches the video from its URL.
            logger.info("YouTube transcript unavailable (%s); falling back to URL summary", error)
            result = learning_service.summarize_from_url_with_gemini(job["text"], error)
            if not result.get("success"):
                raise SourceError(result.get("error") or error or "Could not read the YouTube video.")
            text = result["summary"]
    else:
        with open(job["input_path"], "rb") as fh:
            upload = File(fh, name=job["source_label"])
            text, error = media_processor.extract_content_from_media(**{f"{source_type}_file": upload})
        if error:
            raise SourceError(error)

    if not text or not text.strip():
        raise SourceError("No usable content was found in your input.")
    return text
