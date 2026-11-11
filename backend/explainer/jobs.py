"""
File-backed job store + background executor for long-running generation jobs.

Each job lives in MEDIA_ROOT/<kind>_jobs/<job_id>/ with a `job.json` status
file. Keeping state on disk (instead of only in memory) means status survives
across worker processes and the frontend can resume polling after a reload.

`JobStore` is shared by explainer videos and presentations; each kind gets its
own directory and executor so a long video render never blocks slide decks.
The module-level functions below keep the original explainer API.
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
from typing import Any, Callable, Dict, Iterable, List, Optional

from django.conf import settings

logger = logging.getLogger(__name__)

_JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
# A job not updated for this long while "running" was killed by a server restart.
STALE_AFTER_SECONDS = int(os.getenv("EXPLAINER_STALE_AFTER", str(60 * 60)))
ACTIVE_STATUSES = ("queued", "running")
BASE_PUBLIC_FIELDS = (
    "id", "status", "stage", "progress", "message", "error", "title",
    "source_type", "source_label", "focus", "created_at", "updated_at",
)


class JobStore:
    def __init__(self, kind: str, *, max_workers: int, extra_public_fields: Iterable[str] = (),
                 queued_message: str = "Waiting for a free worker..."):
        self.kind = kind
        self.root = Path(settings.MEDIA_ROOT) / f"{kind}_jobs"
        self.public_fields = BASE_PUBLIC_FIELDS + tuple(extra_public_fields)
        self.queued_message = queued_message
        self._executor = ThreadPoolExecutor(max_workers=max(1, max_workers),
                                            thread_name_prefix=kind)
        self._lock = threading.Lock()

    # ── paths ──────────────────────────────────────────────────────
    def job_dir(self, job_id: str) -> Path:
        if not _JOB_ID_RE.match(job_id or ""):
            raise ValueError("Invalid job id")
        return self.root / job_id

    def _status_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "job.json"

    def _write(self, job: Dict[str, Any]) -> None:
        path = self._status_path(job["id"])
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(job, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    # ── CRUD ───────────────────────────────────────────────────────
    def create(self, user_id: int, source_type: str, source_label: str,
               focus: Optional[str], **extra: Any) -> Dict[str, Any]:
        job_id = uuid.uuid4().hex
        self.job_dir(job_id).mkdir(parents=True, exist_ok=True)
        now = time.time()
        job = {
            "id": job_id, "user_id": user_id, "status": "queued", "stage": "queued",
            "progress": 0, "message": self.queued_message, "error": None, "title": None,
            "source_type": source_type, "source_label": source_label, "focus": focus,
            "created_at": now, "updated_at": now, **extra,
        }
        with self._lock:
            self._write(job)
        return job

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        try:
            path = self._status_path(job_id)
        except ValueError:
            return None
        if not path.exists():
            return None
        with self._lock:
            job = json.loads(path.read_text(encoding="utf-8"))
            if job["status"] in ACTIVE_STATUSES and time.time() - job["updated_at"] > STALE_AFTER_SECONDS:
                job.update(status="failed", stage="failed", updated_at=time.time(),
                           error="Generation was interrupted (server restarted). Please try again.")
                self._write(job)
        return job

    def update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            path = self._status_path(job_id)
            job = json.loads(path.read_text(encoding="utf-8"))
            job.update(fields)
            job["updated_at"] = time.time()
            self._write(job)

    def list(self, user_id: int, limit: int = 20) -> List[Dict[str, Any]]:
        if not self.root.exists():
            return []
        jobs = []
        for d in self.root.iterdir():
            job = self.get(d.name) if d.is_dir() else None
            if job and job.get("user_id") == user_id:
                jobs.append(job)
        jobs.sort(key=lambda j: j["created_at"], reverse=True)
        return jobs[:limit]

    def public_view(self, job: Dict[str, Any]) -> Dict[str, Any]:
        return {k: job.get(k) for k in self.public_fields}

    # ── execution ──────────────────────────────────────────────────
    def submit(self, job_id: str, fn: Callable[[str], None]) -> None:
        """Run fn(job_id) in the background, recording any crash on the job."""
        def _runner():
            try:
                fn(job_id)
            except Exception as e:  # last-resort guard so a job never hangs as "running"
                logger.exception("%s job %s crashed", self.kind, job_id)
                self.update(job_id, status="failed", stage="failed", error=str(e) or "Unexpected error")
        self._executor.submit(_runner)

    def cleanup_work_files(self, job_id: str) -> None:
        """Remove intermediates (work dir, uploaded source); keep job.json + outputs."""
        root = self.job_dir(job_id)
        for name in ("work", "input"):
            shutil.rmtree(root / name, ignore_errors=True)


# ── Explainer video store (original module-level API) ─────────────────

explainer_store = JobStore(
    "explainer",
    max_workers=int(os.getenv("EXPLAINER_MAX_CONCURRENT", "1")),
    extra_public_fields=("transcript", "has_video"),
    queued_message="Waiting for a free video renderer...",
)
JOBS_ROOT = explainer_store.root
PUBLIC_FIELDS = explainer_store.public_fields


def job_dir(job_id: str) -> Path:
    return explainer_store.job_dir(job_id)


def create_job(user_id: int, source_type: str, source_label: str, focus: Optional[str]) -> Dict[str, Any]:
    return explainer_store.create(user_id, source_type, source_label, focus,
                                  transcript=[], has_video=False)


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    return explainer_store.get(job_id)


def update_job(job_id: str, **fields: Any) -> None:
    explainer_store.update(job_id, **fields)


def list_jobs(user_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    return explainer_store.list(user_id, limit)


def video_path(job_id: str) -> Path:
    return job_dir(job_id) / "explainer.mp4"


def public_view(job: Dict[str, Any]) -> Dict[str, Any]:
    return explainer_store.public_view(job)


def submit(job_id: str, fn: Callable[[str], None]) -> None:
    explainer_store.submit(job_id, fn)


def cleanup_work_files(job_id: str) -> None:
    explainer_store.cleanup_work_files(job_id)
