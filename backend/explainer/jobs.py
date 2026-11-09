"""
File-backed job store + background executor for explainer video generation.

Each job lives in MEDIA_ROOT/explainer_jobs/<job_id>/ with a `job.json` status
file. Keeping state on disk (instead of only in memory) means status survives
across worker processes and the frontend can resume polling after a reload.
"""
import json
import logging
import os
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from django.conf import settings

logger = logging.getLogger(__name__)

JOBS_ROOT = Path(settings.MEDIA_ROOT) / "explainer_jobs"
_JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
# A job not updated for this long while "running" was killed by a server restart.
STALE_AFTER_SECONDS = int(os.getenv("EXPLAINER_STALE_AFTER", str(60 * 60)))

_executor = ThreadPoolExecutor(
    max_workers=max(1, int(os.getenv("EXPLAINER_MAX_CONCURRENT", "1"))),
    thread_name_prefix="explainer",
)
_lock = threading.Lock()

ACTIVE_STATUSES = ("queued", "running")
PUBLIC_FIELDS = (
    "id", "status", "stage", "progress", "message", "error", "title", "transcript",
    "source_type", "source_label", "focus", "created_at", "updated_at", "has_video",
)


def job_dir(job_id: str) -> Path:
    if not _JOB_ID_RE.match(job_id or ""):
        raise ValueError("Invalid job id")
    return JOBS_ROOT / job_id


def _status_path(job_id: str) -> Path:
    return job_dir(job_id) / "job.json"


def _write(job: Dict[str, Any]) -> None:
    path = _status_path(job["id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(job, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def create_job(user_id: int, source_type: str, source_label: str, focus: Optional[str]) -> Dict[str, Any]:
    job_id = uuid.uuid4().hex
    job_dir(job_id).mkdir(parents=True, exist_ok=True)
    now = time.time()
    job = {
        "id": job_id,
        "user_id": user_id,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "message": "Waiting for a free video renderer...",
        "error": None,
        "title": None,
        "transcript": [],
        "source_type": source_type,
        "source_label": source_label,
        "focus": focus,
        "created_at": now,
        "updated_at": now,
        "has_video": False,
    }
    with _lock:
        _write(job)
    return job


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    try:
        path = _status_path(job_id)
    except ValueError:
        return None
    if not path.exists():
        return None
    with _lock:
        job = json.loads(path.read_text(encoding="utf-8"))
        if job["status"] in ACTIVE_STATUSES and time.time() - job["updated_at"] > STALE_AFTER_SECONDS:
            job.update(status="failed", stage="failed", updated_at=time.time(),
                       error="Video generation was interrupted (server restarted). Please try again.")
            _write(job)
    return job


def update_job(job_id: str, **fields: Any) -> None:
    with _lock:
        path = _status_path(job_id)
        job = json.loads(path.read_text(encoding="utf-8"))
        job.update(fields)
        job["updated_at"] = time.time()
        _write(job)


def list_jobs(user_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    if not JOBS_ROOT.exists():
        return []
    jobs = []
    for d in JOBS_ROOT.iterdir():
        job = get_job(d.name) if d.is_dir() else None
        if job and job.get("user_id") == user_id:
            jobs.append(job)
    jobs.sort(key=lambda j: j["created_at"], reverse=True)
    return jobs[:limit]


def video_path(job_id: str) -> Path:
    return job_dir(job_id) / "explainer.mp4"


def public_view(job: Dict[str, Any]) -> Dict[str, Any]:
    return {k: job.get(k) for k in PUBLIC_FIELDS}


def submit(job_id: str, fn: Callable[[str], None]) -> None:
    """Run fn(job_id) in the background, recording any crash on the job."""
    def _runner():
        try:
            fn(job_id)
        except Exception as e:  # last-resort guard so a job never hangs as "running"
            logger.exception("Explainer job %s crashed", job_id)
            update_job(job_id, status="failed", stage="failed", error=str(e) or "Unexpected error")
    _executor.submit(_runner)


def cleanup_work_files(job_id: str) -> None:
    """Remove intermediates (audio, renders, uploaded source), keep job.json + final mp4."""
    root = job_dir(job_id)
    for name in ("work", "input"):
        shutil.rmtree(root / name, ignore_errors=True)
