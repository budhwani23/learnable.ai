"""
Glue between learnable.ai's content extraction and the explainer video pipeline.
"""
import logging
import os
import shutil

from . import jobs
from .pipeline import ExplainerPipeline, PipelineError, check_render_environment
from .sources import SourceError, extract_source_text

logger = logging.getLogger(__name__)


def run_explainer_job(job_id: str) -> None:
    job = jobs.get_job(job_id)
    if not job:
        return
    jobs.update_job(job_id, status="running", stage="extracting", progress=2,
                    message="Checking the video renderer...")

    env_problem = check_render_environment()
    if env_problem:
        jobs.update_job(job_id, status="failed", stage="failed", error=env_problem)
        return

    def progress(stage: str, pct: int, msg: str) -> None:
        jobs.update_job(job_id, stage=stage, progress=pct, message=msg)

    try:
        progress("extracting", 4, "Reading your content...")
        source_text = extract_source_text(job)

        work_dir = jobs.job_dir(job_id) / "work"
        pipeline = ExplainerPipeline(str(work_dir), progress=progress)
        result = pipeline.run(source_text, focus=job.get("focus"))

        shutil.copyfile(result["video_path"], jobs.video_path(job_id))
        jobs.update_job(
            job_id, status="succeeded", stage="done", progress=100,
            message="Your explainer video is ready!", title=result["title"],
            transcript=result["beats"], has_video=True,
        )
    except (PipelineError, SourceError) as e:
        jobs.update_job(job_id, status="failed", stage="failed", error=str(e))
    except Exception as e:
        logger.exception("Explainer job %s failed", job_id)
        jobs.update_job(job_id, status="failed", stage="failed",
                        error=f"Video generation failed: {e}")
    finally:
        if os.getenv("EXPLAINER_KEEP_WORK_FILES", "false").lower() not in ("1", "true", "yes"):
            jobs.cleanup_work_files(job_id)
