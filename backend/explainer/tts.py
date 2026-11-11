"""
Local narration for explainer videos with Kokoro-82M (Apache-2.0, ONNX, CPU-only).

Kokoro runs inside the app process: no API key, no per-day quota. The int8 model is
~89 MB plus a ~27 MB voice pack; with the settings below a narration peaks around
+240 MB of RAM and runs at roughly real time on a small CPU.

Settings (env):
    EXPLAINER_TTS_PROVIDER  kokoro (default) | gemini
    EXPLAINER_KOKORO_VOICE  default af_heart (e.g. am_michael, bf_emma, bm_george)
    EXPLAINER_KOKORO_SPEED  default 1.0
    KOKORO_MODEL_DIR        default <backend>/models/kokoro
    KOKORO_AUTO_DOWNLOAD    default true: fetch the model files on first use if missing
"""
import logging
import os
import re
import threading
import urllib.request
import wave
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SAMPLE_RATE = 24000  # Kokoro's output rate; the pipeline's WAVs are 24 kHz mono 16-bit
MODEL_FILE = "kokoro-v1.0.int8.onnx"
VOICES_FILE = "voices-v1.0.bin"
RELEASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
SENTENCE_PAUSE_S = 0.12  # short gap between sentences synthesised separately

_lock = threading.Lock()
_kokoro = None


class TTSError(Exception):
    """Local narration could not be produced."""


def provider() -> str:
    """Which narration engine to use: 'kokoro' (local, default) or 'gemini' (API)."""
    return os.getenv("EXPLAINER_TTS_PROVIDER", "kokoro").strip().lower()


def _model_dir() -> Path:
    default = Path(__file__).resolve().parent.parent / "models" / "kokoro"
    return Path(os.getenv("KOKORO_MODEL_DIR", str(default)))


def _ensure_model_files() -> tuple[Path, Path]:
    """Return (model, voices) paths, downloading them once if allowed and missing."""
    d = _model_dir()
    model, voices = d / MODEL_FILE, d / VOICES_FILE
    missing = [p for p in (model, voices) if not p.exists()]
    if missing:
        if os.getenv("KOKORO_AUTO_DOWNLOAD", "true").lower() not in ("1", "true", "yes"):
            raise TTSError(f"Kokoro model files missing in {d} (set KOKORO_AUTO_DOWNLOAD=true or add them)")
        d.mkdir(parents=True, exist_ok=True)
        for p in missing:
            logger.info("Downloading Kokoro %s ...", p.name)
            tmp = p.with_suffix(p.suffix + ".part")
            urllib.request.urlretrieve(RELEASE_URL + p.name, tmp)
            os.replace(tmp, p)
    return model, voices


def _load():
    """Load Kokoro once (thread-safe), tuned for low memory: no ORT arena, 2 threads."""
    global _kokoro
    with _lock:
        if _kokoro is None:
            import onnxruntime as ort
            from kokoro_onnx import Kokoro

            model, voices = _ensure_model_files()
            so = ort.SessionOptions()
            so.enable_cpu_mem_arena = False  # the arena kept ~300 MB extra between clips
            so.enable_mem_pattern = False
            so.intra_op_num_threads = int(os.getenv("KOKORO_THREADS", "2"))
            so.inter_op_num_threads = 1
            session = ort.InferenceSession(str(model), sess_options=so, providers=["CPUExecutionProvider"])
            _kokoro = Kokoro.from_session(session, str(voices))
        return _kokoro


def release() -> None:
    """Drop the loaded model so its memory is freed between explainer jobs."""
    global _kokoro
    with _lock:
        _kokoro = None


def _sentences(text: str) -> list[str]:
    """Split narration into sentences: shorter inputs keep peak memory low."""
    parts = [s.strip() for s in re.split(r"(?<=[.!?;:])\s+", text.strip()) if s.strip()]
    return parts or [text.strip()]


def synthesize(text: str, wav_path: str, voice: Optional[str] = None) -> str:
    """Narrate `text` with Kokoro into a 24 kHz mono 16-bit WAV at `wav_path`."""
    import numpy as np

    text = (text or "").strip()
    if not text:
        raise TTSError("Nothing to narrate")
    voice = voice or os.getenv("EXPLAINER_KOKORO_VOICE", "af_heart")
    speed = float(os.getenv("EXPLAINER_KOKORO_SPEED", "1.0"))
    try:
        kokoro = _load()
        chunks = []
        for sentence in _sentences(text):
            samples, sr = kokoro.create(sentence, voice=voice, speed=speed, lang="en-us")
            if sr != SAMPLE_RATE:
                raise TTSError(f"Unexpected Kokoro sample rate {sr}")
            chunks += [samples, np.zeros(int(SAMPLE_RATE * SENTENCE_PAUSE_S), dtype=samples.dtype)]
        audio = np.concatenate(chunks[:-1]) if len(chunks) > 1 else chunks[0]
    except TTSError:
        raise
    except Exception as exc:  # model load / phonemizer / onnxruntime problems
        raise TTSError(f"Kokoro narration failed: {exc}") from exc

    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return wav_path
