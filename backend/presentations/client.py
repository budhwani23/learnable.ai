"""
Thin HTTP client for a self-hosted Presenton instance
(https://github.com/presenton/presenton, Apache-2.0).

API used (from Presenton's FastAPI source):
  POST /api/v1/ppt/presentation/generate        GeneratePresentationRequest -> {presentation_id, path, edit_path}
  POST /api/v1/ppt/presentation/{id}/export     {"export_as": "pdf"|"pptx"}  -> same shape
  GET  /app_data/...                            exported files (auth required unless DISABLE_AUTH)
`path` is an absolute path inside the container (under /app_data), not a URL.
"""
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

GENERATE_TIMEOUT = int(os.getenv("PRESENTON_TIMEOUT", "900"))  # seconds; generation is slow
RATE_LIMIT_RETRIES = int(os.getenv("PRESENTON_RATE_LIMIT_RETRIES", "3"))
RATE_LIMIT_WAIT = int(os.getenv("PRESENTON_RATE_LIMIT_WAIT", "45"))  # seconds, grows per attempt

TONES = ("default", "casual", "professional", "funny", "educational", "sales_pitch")
VERBOSITIES = ("concise", "standard", "text-heavy")


class PresentonError(Exception):
    """User-presentable failure talking to Presenton."""


def _base_url() -> str:
    return os.getenv("PRESENTON_URL", "http://localhost:5001").rstrip("/")


def _headers() -> Dict[str, str]:
    key = os.getenv("PRESENTON_API_KEY")
    return {"Authorization": f"Bearer {key}"} if key else {}


def _raise_for(resp: requests.Response) -> None:
    if resp.ok:
        return
    detail = ""
    try:
        body = resp.json()
        detail = body.get("detail") if isinstance(body, dict) else ""
        if isinstance(detail, list):  # FastAPI validation errors
            detail = "; ".join(str(d.get("msg", d)) for d in detail)
    except ValueError:
        detail = resp.text[:300]
    if resp.status_code in (401, 403):
        raise PresentonError("The presentation service rejected our credentials. Check PRESENTON_API_KEY.")
    if resp.status_code == 428:
        raise PresentonError("The presentation service needs its first-time setup (or DISABLE_AUTH for local dev).")
    raise PresentonError(f"Presentation service error ({resp.status_code}): {detail or 'unknown error'}")


def _post(path: str, payload: Dict[str, Any], timeout: int) -> Dict[str, Any]:
    # Presenton surfaces the LLM provider's rate limits / overload as 429 or 503
    # (e.g. Gemini free tier allows only a few requests per minute). Wait and retry.
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        try:
            resp = requests.post(f"{_base_url()}{path}", json=payload, headers=_headers(), timeout=timeout)
        except requests.ConnectionError:
            raise PresentonError("The presentation service is not running. Start it with "
                                 "`docker compose --env-file backend/.env up -d presenton`.")
        except requests.Timeout:
            raise PresentonError("The presentation service took too long to respond. Please try again.")
        if resp.status_code not in (429, 503) or attempt == RATE_LIMIT_RETRIES:
            break
        time.sleep(RATE_LIMIT_WAIT * (attempt + 1))
    if resp.status_code in (429, 503):
        raise PresentonError("The AI service is busy or rate-limited right now. Please try again in a few minutes.")
    _raise_for(resp)
    return resp.json()


def check_available() -> Optional[str]:
    """Return a human-readable problem if Presenton can't be reached, else None."""
    try:
        requests.get(f"{_base_url()}/api/v1/auth/status", timeout=10)
    except requests.RequestException:
        return ("The presentation service is not running. Start it with "
                "`docker compose --env-file backend/.env up -d presenton`.")
    return None


def generate(content: str, *, instructions: Optional[str], n_slides: int, template: str,
             tone: str, verbosity: str = "standard", language: Optional[str] = None,
             export_as: str = "pptx") -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "content": content,
        "n_slides": n_slides,
        "template": template,
        "tone": tone if tone in TONES else "default",
        "verbosity": verbosity if verbosity in VERBOSITIES else "standard",
        "include_title_slide": True,
        "export_as": export_as,
    }
    if instructions:
        payload["instructions"] = instructions
    if language:
        payload["language"] = language
    return _post("/api/v1/ppt/presentation/generate", payload, GENERATE_TIMEOUT)


def export(presentation_id: str, export_as: str) -> Dict[str, Any]:
    return _post(f"/api/v1/ppt/presentation/{presentation_id}/export", {"export_as": export_as},
                 GENERATE_TIMEOUT)


def download(path: str, dest: Path) -> None:
    """Fetch an exported file (`path` from a generate/export response) to `dest`."""
    if path.startswith(("http://", "https://")):
        url = path
    else:
        # Container paths look like /app_data/...; Presenton serves them at the same URL path.
        idx = path.find("/app_data/")
        if idx == -1:
            raise PresentonError(f"Unexpected export path from presentation service: {path}")
        local_root = os.getenv("PRESENTON_DATA_DIR")  # optional: read straight from the mounted volume
        rel = path[idx + len("/app_data/"):]
        if local_root and (Path(local_root) / rel).exists():
            dest.write_bytes((Path(local_root) / rel).read_bytes())
            return
        url = f"{_base_url()}/app_data/{rel}"
    try:
        with requests.get(url, headers=_headers(), timeout=300, stream=True) as resp:
            _raise_for(resp)
            with open(dest, "wb") as out:
                for chunk in resp.iter_content(1 << 16):
                    out.write(chunk)
    except requests.RequestException as e:
        raise PresentonError(f"Could not download the presentation file: {e}")
