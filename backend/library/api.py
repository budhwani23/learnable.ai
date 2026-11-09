# library/api.py — save, share and take learning resources
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

from django.http import FileResponse, Http404
from ninja import Schema
from ninja.router import Router

from explainer import jobs as explainer_jobs
from users.security import JWTAuth

from .models import LearningResource, QuizAttempt, ResourceAccess
from .services import can_view, grade_quiz, grant_access

router = Router(auth=JWTAuth())

MAX_PAYLOAD_BYTES = 1_000_000
VALID_TYPES = {t for t, _ in LearningResource.TYPES}


class ResourceIn(Schema):
    type: str
    title: str
    payload: Dict[str, Any] = {}
    explainer_job_id: Optional[str] = None


class SharingIn(Schema):
    share_enabled: bool


class AttemptIn(Schema):
    answers: List[Optional[str]]
    lti_launch_id: Optional[str] = None


def _summary(r: LearningResource, user) -> Dict[str, Any]:
    return {
        "id": str(r.id), "type": r.type, "title": r.title,
        "created_at": r.created_at.isoformat(), "share_enabled": r.share_enabled,
        "is_owner": r.owner_id == user.id, "max_score": r.max_score,
    }


def _get(resource_id: UUID) -> LearningResource:
    r = LearningResource.objects.filter(id=resource_id).first()
    if not r:
        raise Http404("Resource not found")
    return r


@router.post("/resources")
def create_resource(request, data: ResourceIn):
    """Save a generated result so it can be shared to a class."""
    user = request.auth
    if data.type not in VALID_TYPES:
        return {"error": f"Unknown resource type '{data.type}'."}
    title = data.title.strip()[:200] or "Untitled"
    if len(json.dumps(data.payload)) > MAX_PAYLOAD_BYTES:
        return {"error": "This resource is too large to save."}

    job_id = ""
    if data.type == LearningResource.TYPE_VIDEO:
        job = explainer_jobs.get_job(data.explainer_job_id or "")
        if not job or job.get("user_id") != user.id or not job.get("has_video"):
            return {"error": "That explainer video isn't finished or doesn't belong to you."}
        job_id = job["id"]
        payload = {"title": job.get("title"), "transcript": job.get("transcript") or []}
    else:
        payload = data.payload
        if data.type == LearningResource.TYPE_QUIZ and not (payload.get("quiz") or []):
            return {"error": "Quiz has no questions."}

    r = LearningResource.objects.create(owner=user, type=data.type, title=title,
                                        payload=payload, explainer_job_id=job_id)
    return {"success": True, "resource": _summary(r, user)}


@router.get("/resources")
def list_resources(request, type: Optional[str] = None):
    """The current user's saved resources (newest first)."""
    qs = LearningResource.objects.filter(owner=request.auth)
    if type:
        qs = qs.filter(type=type)
    return {"success": True, "resources": [_summary(r, request.auth) for r in qs[:100]]}


@router.get("/resources/{resource_id}")
def get_resource(request, resource_id: UUID):
    r = _get(resource_id)
    if not can_view(request.auth, r):
        raise Http404("Resource not found")
    if r.share_enabled:
        grant_access(request.auth, r, ResourceAccess.VIA_LINK)
    data = _summary(r, request.auth)
    payload = dict(r.payload)
    if r.type == LearningResource.TYPE_QUIZ and r.owner_id != request.auth.id:
        # Students get the questions, not the answer key — grading happens server-side.
        payload["quiz"] = [{"question": q.get("question"), "options": q.get("options")}
                           for q in payload.get("quiz") or []]
    data["payload"] = payload
    return {"success": True, "resource": data}


@router.patch("/resources/{resource_id}/sharing")
def set_sharing(request, resource_id: UUID, data: SharingIn):
    r = _get(resource_id)
    if r.owner_id != request.auth.id:
        raise Http404("Resource not found")
    r.share_enabled = data.share_enabled
    r.save(update_fields=["share_enabled"])
    return {"success": True, "resource": _summary(r, request.auth)}


@router.get("/resources/{resource_id}/video")
def get_resource_video(request, resource_id: UUID):
    """Stream a saved explainer video to anyone allowed to view the resource."""
    r = _get(resource_id)
    if r.type != LearningResource.TYPE_VIDEO or not can_view(request.auth, r):
        raise Http404("Video not found")
    path = explainer_jobs.video_path(r.explainer_job_id)
    if not path.exists():
        raise Http404("Video not found")
    return FileResponse(open(path, "rb"), content_type="video/mp4")


@router.post("/resources/{resource_id}/attempts")
def submit_attempt(request, resource_id: UUID, data: AttemptIn):
    """Grade a quiz attempt on the server and, for LMS launches, send it to the gradebook."""
    r = _get(resource_id)
    if r.type != LearningResource.TYPE_QUIZ or not can_view(request.auth, r):
        raise Http404("Quiz not found")
    score, max_score = grade_quiz(r, data.answers)
    attempt = QuizAttempt.objects.create(user=request.auth, resource=r, answers=data.answers,
                                         score=score, max_score=max_score,
                                         lti_launch_id=data.lti_launch_id or "")
    if attempt.lti_launch_id:
        from lti.services import submit_grade  # local import: lti depends on library
        submit_grade(request, attempt)
        attempt.refresh_from_db()

    # Return the answer key now that the attempt is recorded, so the UI can show results.
    answer_key = [{"correct_answer": q.get("correct_answer"), "explanation": q.get("explanation", "")}
                  for q in (r.payload or {}).get("quiz") or []]
    return {"success": True, "score": score, "max_score": max_score,
            "grade_synced": attempt.grade_synced, "grade_sync_error": attempt.grade_sync_error or None,
            "answer_key": answer_key}
