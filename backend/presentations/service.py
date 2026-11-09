"""Background worker: student input -> Presenton slide deck (PPTX + PDF preview)."""
import html
import logging
import os
import re
import zipfile
from pathlib import Path
from typing import Optional

from explainer.jobs import JobStore
from explainer.sources import SourceError, extract_source_text

from . import client

logger = logging.getLogger(__name__)

MAX_SOURCE_CHARS = 40000

store = JobStore(
    "presentation",
    max_workers=int(os.getenv("PRESENTATION_MAX_CONCURRENT", "2")),
    extra_public_fields=("n_slides", "template", "tone", "slide_count", "has_pptx", "has_pdf"),
    queued_message="Waiting for the presentation service...",
)


def file_path(job_id: str, fmt: str) -> Path:
    return store.job_dir(job_id) / f"slides.{fmt}"


def _pptx_info(path: Path) -> tuple[Optional[str], int]:
    """(first text on slide 1, slide count) read straight from the PPTX zip."""
    try:
        with zipfile.ZipFile(path) as z:
            slides = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
            title = None
            if "ppt/slides/slide1.xml" in slides:
                xml = z.read("ppt/slides/slide1.xml").decode("utf-8", "ignore")
                texts = [html.unescape(t).strip() for t in re.findall(r"<a:t>([^<]*)</a:t>", xml)]
                title = next((t for t in texts if t), None)
            return (title[:120] if title else None), len(slides)
    except (zipfile.BadZipFile, OSError):
        return None, 0


def run_presentation_job(job_id: str) -> None:
    job = store.get(job_id)
    if not job:
        return
    update = lambda **kw: store.update(job_id, **kw)  # noqa: E731
    update(status="running", stage="extracting", progress=5, message="Reading your content...")

    problem = client.check_available()
    if problem:
        update(status="failed", stage="failed", error=problem)
        return

    try:
        text = extract_source_text(job)
        if len(text) > MAX_SOURCE_CHARS:
            text = text[:MAX_SOURCE_CHARS] + "\n...[truncated]"

        instructions = ("Audience: a student studying this material. Make the slides clear, "
                        "well-structured and faithful to the source.")
        if job.get("focus"):
            instructions += f" Focus especially on: {job['focus']}"

        update(stage="generating", progress=20,
               message=f"Designing {job['n_slides']} slides (this takes a few minutes)...")
        result = client.generate(text, instructions=instructions, n_slides=job["n_slides"],
                                 template=job["template"], tone=job["tone"], export_as="pptx")

        update(stage="exporting", progress=80, message="Exporting PowerPoint file...")
        pptx = file_path(job_id, "pptx")
        client.download(result["path"], pptx)
        title, slide_count = _pptx_info(pptx)

        update(stage="exporting", progress=90, message="Preparing the PDF preview...")
        has_pdf = False
        try:
            pdf_result = client.export(str(result["presentation_id"]), "pdf")
            client.download(pdf_result["path"], file_path(job_id, "pdf"))
            has_pdf = True
        except client.PresentonError as e:  # preview is optional; the PPTX is the deliverable
            logger.warning("PDF export failed for %s: %s", job_id, e)

        update(status="succeeded", stage="done", progress=100, message="Your presentation is ready!",
               title=title or job["source_label"], slide_count=slide_count,
               has_pptx=True, has_pdf=has_pdf, presenton_id=str(result["presentation_id"]))
    except (client.PresentonError, SourceError) as e:
        update(status="failed", stage="failed", error=str(e))
    except Exception as e:
        logger.exception("Presentation job %s failed", job_id)
        update(status="failed", stage="failed", error=f"Presentation generation failed: {e}")
    finally:
        store.cleanup_work_files(job_id)
