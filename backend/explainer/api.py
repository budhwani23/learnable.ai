# explainer/api.py
import os
from typing import Optional

from django.http import FileResponse, Http404
from ninja import File, Schema
from ninja.files import UploadedFile
from ninja.router import Router

from constants import (
    ALLOWED_AUDIO_EXTENSIONS, ALLOWED_DOCUMENT_EXTENSIONS, ALLOWED_VIDEO_EXTENSIONS,
)
from users.security import JWTAuth
from utils.youtube import is_youtube_url

from . import jobs
from .service import run_explainer_job

router = Router(auth=JWTAuth())

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED = {
    "audio": ALLOWED_AUDIO_EXTENSIONS,
    "video": ALLOWED_VIDEO_EXTENSIONS,
    "document": ALLOWED_DOCUMENT_EXTENSIONS,
}


class ExplainerVideoInput(Schema):
    text: Optional[str] = None   # free text, topic, or a YouTube URL
    focus: Optional[str] = None  # optional: what the student wants explained


def _owned_job(request, job_id: str) -> dict:
    job = jobs.get_job(job_id)
    if not job or job.get("user_id") != request.auth.id:
        raise Http404("Job not found")
    return job


@router.post("/jobs")
def create_explainer_job(
    request,
    data: Optional[ExplainerVideoInput] = None,
    audio_file: Optional[UploadedFile] = File(None),
    video_file: Optional[UploadedFile] = File(None),
    document_file: Optional[UploadedFile] = File(None),
):
    """
    Start generating an AI explainer video from text, a YouTube URL, or an
    uploaded audio / video / document file. Returns a job to poll.
    """
    text = (data.text or "").strip() if data else ""
    focus = ((data.focus or "").strip()[:300] or None) if data else None

    upload, kind = None, None
    for k, f in (("audio", audio_file), ("video", video_file), ("document", document_file)):
        if f:
            upload, kind = f, k
            break

    if upload:
        ext = os.path.splitext(upload.name or "")[1].lower()
        if ext not in ALLOWED[kind]:
            return {"error": f"Unsupported {kind} format. Allowed: {', '.join(ALLOWED[kind])}"}
        if upload.size > MAX_UPLOAD_BYTES:
            return {"error": "File size exceeds the 50MB limit."}
        source_type = kind
        source_label = os.path.basename(upload.name)[:200]
    elif text:
        source_type = "youtube" if is_youtube_url(text) else "text"
        source_label = text if source_type == "youtube" else (text[:80] + ("..." if len(text) > 80 else ""))
    else:
        return {"error": "No content provided. Please enter text, a YouTube URL, or upload a file."}

    job = jobs.create_job(request.auth.id, source_type, source_label, focus)
    extra = {"text": text} if not upload else {}
    if upload:
        input_dir = jobs.job_dir(job["id"]) / "input"
        input_dir.mkdir(parents=True, exist_ok=True)
        input_path = input_dir / f"source{ext}"
        with open(input_path, "wb") as out:
            for chunk in upload.chunks():
                out.write(chunk)
        extra["input_path"] = str(input_path)
    jobs.update_job(job["id"], **extra)

    jobs.submit(job["id"], run_explainer_job)
    return {"success": True, "job": jobs.public_view(jobs.get_job(job["id"]))}


@router.get("/jobs")
def list_explainer_jobs(request):
    """The current user's most recent explainer videos."""
    return {"success": True, "jobs": [jobs.public_view(j) for j in jobs.list_jobs(request.auth.id)]}


@router.get("/jobs/{job_id}")
def get_explainer_job(request, job_id: str):
    """Poll the status / progress of an explainer video job."""
    return {"success": True, "job": jobs.public_view(_owned_job(request, job_id))}


@router.get("/jobs/{job_id}/video")
def get_explainer_video(request, job_id: str, download: bool = False):
    """Stream the finished MP4 (owner only)."""
    job = _owned_job(request, job_id)
    path = jobs.video_path(job_id)
    if not job.get("has_video") or not path.exists():
        raise Http404("Video not ready")
    safe_title = "".join(c for c in (job.get("title") or "explainer") if c.isalnum() or c in " -_").strip()
    return FileResponse(open(path, "rb"), content_type="video/mp4", as_attachment=download,
                        filename=f"{safe_title or 'explainer'}.mp4")
