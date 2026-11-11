"""Tests for local narration, empty-answer handling and render guards in the explainer pipeline."""
import importlib.util
import os
import tempfile
import unittest
import wave
from unittest import mock

from django.test import SimpleTestCase

# numpy comes with the video extras (requirements-video.txt), which CI's test job doesn't install.
HAS_NUMPY = importlib.util.find_spec("numpy") is not None

from core import cerebras
from explainer import pipeline as P
from explainer import tts

WITH_CEREBRAS = {"CEREBRAS_API_KEY": "test-key"}


def _completion(content, finish="stop"):
    """A minimal Cerebras chat-completion payload."""
    return {"choices": [{"message": {"content": content}, "finish_reason": finish}]}


class CerebrasEmptyAnswerTests(SimpleTestCase):
    """qwen can spend every token on hidden reasoning and answer with nothing."""

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_retries_with_low_effort_when_reasoning_used_all_tokens(self):
        """An empty, length-cut answer is retried once with low effort and a bigger limit."""
        with mock.patch.object(cerebras, "complete",
                               side_effect=[_completion("", "length"), _completion("class GeneratedScene: ...")]) as c:
            out = cerebras.chat("write a scene", max_tokens=16000, reasoning_effort="medium")
        self.assertEqual(out, "class GeneratedScene: ...")
        retry_payload = c.call_args_list[1].args[0]
        self.assertEqual(retry_payload["reasoning_effort"], "low")
        self.assertGreaterEqual(retry_payload["max_completion_tokens"], 32000)

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_raises_instead_of_returning_empty_text(self):
        """If the retry is also empty, a CerebrasError is raised (never a silent empty scene)."""
        with mock.patch.object(cerebras, "complete", return_value=_completion("", "length")):
            with self.assertRaises(cerebras.CerebrasError):
                cerebras.chat("write a scene")

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_reasoning_effort_is_sent(self):
        """The requested reasoning effort is passed through to Cerebras."""
        with mock.patch.object(cerebras, "complete", return_value=_completion("ok")) as c:
            cerebras.chat("hi", reasoning_effort="medium")
        self.assertEqual(c.call_args.args[0]["reasoning_effort"], "medium")


class RenderGuardTests(SimpleTestCase):
    """Videos far shorter than their narration are rejected and sent back to be fixed."""

    def _pipeline(self):
        """A pipeline in a temp dir with ffprobe treated as available."""
        with mock.patch.dict(os.environ, {"GOOGLE_API_KEY": "x"}):
            p = P.ExplainerPipeline(tempfile.mkdtemp())
        p.has_ffmpeg = True
        return p

    def test_one_frame_video_is_rejected(self):
        """A 0.03 s render against 50 s of narration produces a repair instruction."""
        p = self._pipeline()
        with mock.patch.object(p, "video_duration", return_value=0.033):
            err = p._too_short("v.mp4", [{"duration": 25.0}, {"duration": 25.0}])
        self.assertIn("only 0.03s", err)

    def test_full_length_video_passes(self):
        """A render as long as its narration passes the check."""
        p = self._pipeline()
        with mock.patch.object(p, "video_duration", return_value=49.0):
            self.assertEqual(p._too_short("v.mp4", [{"duration": 25.0}, {"duration": 25.0}]), "")


class NarrationProviderTests(SimpleTestCase):
    """Kokoro narrates locally; Gemini is only a fallback."""

    def _pipeline(self):
        """A pipeline in a temp dir (no network used by these tests)."""
        with mock.patch.dict(os.environ, {"GOOGLE_API_KEY": "x"}):
            return P.ExplainerPipeline(tempfile.mkdtemp())

    @mock.patch.dict(os.environ, {"EXPLAINER_TTS_PROVIDER": "kokoro", "GOOGLE_API_KEY": "x"})
    def test_uses_kokoro_without_calling_gemini(self):
        """With the kokoro provider, a beat is narrated locally and Gemini is never called."""
        p = self._pipeline()
        with mock.patch.object(tts, "synthesize", side_effect=lambda text, path: path) as synth, \
                mock.patch.object(p, "_gemini_tts") as gemini:
            p.tts_segment("Hello there.", 1)
        synth.assert_called_once()
        gemini.assert_not_called()

    @mock.patch.dict(os.environ, {"EXPLAINER_TTS_PROVIDER": "kokoro", "GOOGLE_API_KEY": "x"})
    def test_falls_back_to_gemini_when_local_fails(self):
        """If Kokoro fails and a Google key exists, Gemini TTS narrates the beat instead."""
        p = self._pipeline()
        with mock.patch.object(tts, "synthesize", side_effect=tts.TTSError("model missing")), \
                mock.patch.object(p, "_gemini_tts", return_value="seg.wav") as gemini:
            self.assertEqual(p.tts_segment("Hello there.", 1), "seg.wav")
        gemini.assert_called_once()

    @unittest.skipUnless(HAS_NUMPY, "needs numpy (installed with requirements-video.txt)")
    def test_kokoro_writes_24khz_mono_wav(self):
        """synthesize() writes 24 kHz mono 16-bit audio, joining sentences with short pauses."""
        import numpy as np

        fake = mock.Mock()
        fake.create.return_value = (np.zeros(2400, dtype=np.float32), tts.SAMPLE_RATE)
        out = os.path.join(tempfile.mkdtemp(), "seg.wav")
        with mock.patch.object(tts, "_load", return_value=fake):
            tts.synthesize("First sentence. Second one!", out)
        self.assertEqual(fake.create.call_count, 2)  # one call per sentence
        with wave.open(out, "rb") as wf:
            self.assertEqual((wf.getnchannels(), wf.getsampwidth(), wf.getframerate()), (1, 2, 24000))
            self.assertEqual(wf.getnframes(), 2400 * 2 + int(24000 * tts.SENTENCE_PAUSE_S))
