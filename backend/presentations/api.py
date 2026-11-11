# presentations/api.py
from typing import Optional

from django.http import FileResponse, Http404
from ninja import File, Schema
from ninja.files import UploadedFile
from ninja.router import Router

from explainer.sources import describe_input, save_upload
from users import credits
from users.security import JWTAuth

from . import client
from .service import file_path, run_presentation_job, store

router = Router(auth=JWTAuth())

# Bundled Presenton templates surfaced to students.
TEMPLATES = [
    {"id": "general", "name": "General"},
    {"id": "modern", "name": "Modern"},
    {"id": "standard", "name": "Standard"},
    {"id": "swift", "name": "Swift"},
]
TEMPLATE_IDS = {t["id"] for t in TEMPLATES}
TONES = [
    {"id": "educational", "name": "Educational"},
    {"id": "default", "name": "Neutral"},
    {"id": "casual", "name": "Casual"},
    {"id": "professional", "name": "Professional"},
    {"id": "funny", "name": "Fun"},
]


class PresentationInput(Schema):
    """Optional text input for a slide deck job: source, focus, slide count, template and tone."""
    text: Optional[str] = None    # free text, topic, or a YouTube URL
    focus: Optional[str] = None
    n_slides: int = 8
    template: str = "general"
    tone: str = "educational"


def _owned_job(request, job_id: str) -> dict:
    """Return the presentation job if it belongs to the signed-in user; otherwise raise Http404."""
    job = store.get(job_id)
    if not job or job.get("user_id") != request.auth.id:
        raise Http404("Job not found")
    return job


@router.get("/options")
def presentation_options(request):
    """Templates and tones the Slides tab can offer."""
    return {"success": True, "templates": TEMPLATES, "tones": TONES}


@router.post("/jobs")
def create_presentation_job(
    request,
    data: Optional[PresentationInput] = None,
    audio_file: Optional[UploadedFile] = File(None),
    video_file: Optional[UploadedFile] = File(None),
    document_file: Optional[UploadedFile] = File(None),
):
    """Start generating a slide deck from text, a YouTube URL, or an uploaded file."""
    data = data or PresentationInput()
    spec, error = describe_input(data.text or "", audio_file, video_file, document_file)
    if error:
        return {"error": error}
    if data.template not in TEMPLATE_IDS:
        return {"error": "Unknown template."}
    if data.tone not in client.TONES:
        return {"error": "Unknown tone."}
    n_slides = max(3, min(20, int(data.n_slides or 8)))
    focus = (data.focus or "").strip()[:300] or None

    # One "slides" credit per started job; given back if the job fails.
    try:
        event = credits.consume(request.auth, "slides", ref="presentation")
    except credits.OutOfCredits as exc:
        return credits.out_of_credits_response(request.auth, exc)
    try:
        job = store.create(request.auth.id, spec["source_type"], spec["source_label"], focus,
                           n_slides=n_slides, template=data.template, tone=data.tone,
                           slide_count=0, has_pptx=False, has_pdf=False)
        store.update(job["id"], usage_event_id=event.id, **save_upload(spec, store.job_dir(job["id"])))
        store.submit(job["id"], credits.refund_if_job_failed(run_presentation_job, store.get))
    except Exception:
        credits.refund(event.id)
        raise
    return {"success": True, "job": store.public_view(store.get(job["id"]))}


@router.get("/jobs")
def list_presentation_jobs(request):
    """List the signed-in user's presentation jobs (public view)."""
    return {"success": True, "jobs": [store.public_view(j) for j in store.list(request.auth.id)]}


@router.get("/jobs/{job_id}")
def get_presentation_job(request, job_id: str):
    """Return one of the signed-in user's presentation jobs, or 404."""
    return {"success": True, "job": store.public_view(_owned_job(request, job_id))}


@router.get("/jobs/{job_id}/file")
def get_presentation_file(request, job_id: str, format: str = "pptx", download: bool = False):
    """Owner-only download of the generated deck (pptx) or its PDF preview."""
    job = _owned_job(request, job_id)
    if format not in ("pptx", "pdf") or not job.get(f"has_{format}"):
        raise Http404("File not available")
    path = file_path(job_id, format)
    if not path.exists():
        raise Http404("File not available")
    content_type = ("application/pdf" if format == "pdf" else
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    safe = "".join(c for c in (job.get("title") or "presentation") if c.isalnum() or c in " -_").strip()
    return FileResponse(open(path, "rb"), content_type=content_type, as_attachment=download,
                        filename=f"{safe or 'presentation'}.{format}")
