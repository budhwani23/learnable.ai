"""
Glue between learnable.ai's content extraction and the explainer video pipeline.
"""
import logging
import os
import shutil
from typing import Optional

from django.core.files import File

from core.gemini import GeminiService
from learning.learning_service import LearningService
from utils.media_processor import MediaProcessor
from utils.youtube import is_youtube_url, get_youtube_transcript

from . import jobs
from .pipeline import ExplainerPipeline, PipelineError, check_render_environment

logger = logging.getLogger(__name__)

_gemini: Optional[GeminiService] = None


def _services():
    global _gemini
    if _gemini is None:
        _gemini = GeminiService(model_name="gemini-3-flash-preview", temperature=0.7)
    return MediaProcessor(_gemini), LearningService(_gemini)


def _extract_source_text(job: dict) -> str:
    """Turn the job's input (text / YouTube URL / saved upload) into plain text."""
    source_type = job["source_type"]
    media_processor, learning_service = _services()

    if source_type == "text":
        return job["text"]

    if source_type == "youtube":
        transcript, error = get_youtube_transcript(job["text"])
        if transcript:
            return transcript
        # No transcript available -> let Gemini read the video from its URL.
        logger.info("YouTube transcript unavailable (%s); falling back to URL summary", error)
        result = learning_service.summarize_from_url(job["text"])
        if not result.get("success"):
            raise PipelineError(result.get("error") or error or "Could not read the YouTube video.")
        return result["summary"]

    # audio / video / document: the upload was saved to disk at job creation
    path = job["input_path"]
    with open(path, "rb") as fh:
        upload = File(fh, name=job["source_label"])
        kwargs = {f"{source_type}_file": upload}
        content, error = media_processor.extract_content_from_media(**kwargs)
    if error or not content:
        raise PipelineError(error or "Could not extract any content from the uploaded file.")
    return content


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
        source_text = _extract_source_text(job)
        if not source_text or not source_text.strip():
            raise PipelineError("No usable content was found in your input.")

        work_dir = jobs.job_dir(job_id) / "work"
        pipeline = ExplainerPipeline(str(work_dir), progress=progress)
        result = pipeline.run(source_text, focus=job.get("focus"))

        shutil.copyfile(result["video_path"], jobs.video_path(job_id))
        jobs.update_job(
            job_id, status="succeeded", stage="done", progress=100,
            message="Your explainer video is ready!", title=result["title"],
            transcript=result["beats"], has_video=True,
        )
    except PipelineError as e:
        jobs.update_job(job_id, status="failed", stage="failed", error=str(e))
    except Exception as e:
        logger.exception("Explainer job %s failed", job_id)
        jobs.update_job(job_id, status="failed", stage="failed",
                        error=f"Video generation failed: {e}")
    finally:
        if os.getenv("EXPLAINER_KEEP_WORK_FILES", "false").lower() not in ("1", "true", "yes"):
            jobs.cleanup_work_files(job_id)
