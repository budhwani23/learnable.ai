# explainer/api.py
from typing import Optional

from django.http import FileResponse, Http404
from ninja import File, Schema
from ninja.files import UploadedFile
from ninja.router import Router

from users import credits
from users.security import JWTAuth

from . import jobs
from .service import run_explainer_job
from .sources import describe_input, save_upload

router = Router(auth=JWTAuth())


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
    focus = ((data.focus or "").strip()[:300] or None) if data else None
    spec, error = describe_input(data.text if data else "", audio_file, video_file, document_file)
    if error:
        return {"error": error}

    # One "video" credit per started job; given back if the job fails.
    try:
        event = credits.consume(request.auth, "video", ref="explainer")
    except credits.OutOfCredits as exc:
        return credits.out_of_credits_response(request.auth, exc)
    try:
        job = jobs.create_job(request.auth.id, spec["source_type"], spec["source_label"], focus)
        jobs.update_job(job["id"], usage_event_id=event.id, **save_upload(spec, jobs.job_dir(job["id"])))
        jobs.submit(job["id"], credits.refund_if_job_failed(run_explainer_job, jobs.get_job))
    except Exception:
        credits.refund(event.id)
        raise
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
