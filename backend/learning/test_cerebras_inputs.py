"""
Inputs moved from Gemini to Cerebras qwen (with Gemini as fallback): scanned PDFs,
YouTube links and the explainer's frame review. All providers are mocked.
"""
import io
import json
import os
import tempfile
from unittest import mock

from django.test import SimpleTestCase
from PIL import Image, ImageDraw

from core import cerebras
from learning.learning_service import LearningService
from utils.media_processor import MediaProcessor

WITH_CEREBRAS = {"CEREBRAS_API_KEY": "test-key"}


def make_image_pdf(n_pages: int) -> str:
    """An image-only PDF (no text layer), like a scan or slides exported as images."""
    pages = []
    for i in range(n_pages):
        im = Image.new("RGB", (600, 800), "white")
        ImageDraw.Draw(im).text((50, 50), f"Scanned page {i + 1}", fill="black")
        pages.append(im)
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    pages[0].save(path, "PDF", save_all=True, append_images=pages[1:])
    return path


def image_parts(content):
    return [p for p in content if p.get("type") == "image_url"]


class CerebrasClientTests(SimpleTestCase):
    def _response(self, status, body):
        resp = mock.Mock(status_code=status, text=json.dumps(body))
        resp.json.return_value = body
        return resp

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_sends_user_agent_and_images(self):
        ok = self._response(200, {"choices": [{"message": {"content": " Red "}}]})
        with mock.patch("core.cerebras.requests.post", return_value=ok) as post:
            out = cerebras.chat(cerebras.text_and_images("Colour?", [b"\x89PNG"]))
        self.assertEqual(out, "Red")
        kwargs = post.call_args.kwargs
        self.assertTrue(kwargs["headers"]["User-Agent"])
        part = kwargs["json"]["messages"][0]["content"][1]
        self.assertEqual(part["type"], "image_url")
        self.assertTrue(part["image_url"]["url"].startswith("data:image/png;base64,"))

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_retries_rate_limit_but_not_bad_request(self):
        ok = self._response(200, {"choices": [{"message": {"content": "hi"}}]})
        limited = self._response(429, {"error": "slow down"})
        with mock.patch("core.cerebras.time.sleep"), \
                mock.patch("core.cerebras.requests.post", side_effect=[limited, ok]) as post:
            self.assertEqual(cerebras.chat("hello"), "hi")
            self.assertEqual(post.call_count, 2)

        bad = self._response(400, {"error": "unsupported content"})
        with mock.patch("core.cerebras.time.sleep"), \
                mock.patch("core.cerebras.requests.post", return_value=bad) as post:
            with self.assertRaisesMessage(cerebras.CerebrasError, "HTTP 400"):
                cerebras.chat("hello")
            self.assertEqual(post.call_count, 1)

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_langchain_service_sends_user_agent(self):
        from core.gemini import CerebrasService
        self.assertIn("User-Agent", CerebrasService().llm.default_headers)


class ScannedPdfTests(SimpleTestCase):
    def setUp(self):
        self.gemini = mock.Mock()
        self.processor = MediaProcessor(self.gemini, mock.Mock())
        self.paths = []

    def tearDown(self):
        for p in self.paths:
            os.unlink(p)

    def pdf(self, n):
        path = make_image_pdf(n)
        self.paths.append(path)
        return path

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_scanned_pdf_is_read_by_qwen_in_page_batches(self):
        path = self.pdf(6)
        replies = iter(["--- Page 1 ---\nfirst batch", "--- Page 5 ---\nsecond batch"])
        with mock.patch("utils.media_processor.cerebras.chat", side_effect=lambda *a, **k: next(replies)) as chat:
            text = self.processor._extract_text_from_document(path, ".pdf")
        self.assertEqual(chat.call_count, 2)  # 6 pages, 4 per request
        batch_sizes = sorted(len(image_parts(c.args[0])) for c in chat.call_args_list)
        self.assertEqual(batch_sizes, [2, 4])
        url = image_parts(chat.call_args_list[0].args[0])[0]["image_url"]["url"]
        self.assertTrue(url.startswith("data:image/jpeg;base64,"))
        self.assertLess(text.index("first batch"), text.index("second batch"))
        self.gemini.llm.invoke.assert_not_called()

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_only_pages_without_text_go_to_vision(self):
        path = self.pdf(3)
        layer = ["Page one has plenty of selectable text here.", "",
                 "Page three also has plenty of selectable text."]
        with mock.patch.object(MediaProcessor, "_pdf_text_layer", return_value=layer), \
                mock.patch("utils.media_processor.cerebras.chat", return_value="FIGURE PAGE") as chat:
            text = self.processor._extract_text_from_document(path, ".pdf")
        self.assertEqual(chat.call_count, 1)
        self.assertEqual(len(image_parts(chat.call_args.args[0])), 1)
        self.assertIn("pages 2 of", chat.call_args.args[0][0]["text"])
        self.assertEqual(text.split("\n"), [layer[0], "FIGURE PAGE", layer[2]])

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_too_many_scanned_pages_gives_a_clear_error(self):
        path = self.pdf(3)
        with mock.patch.object(MediaProcessor, "MAX_SCANNED_PDF_PAGES", 2), \
                mock.patch("utils.media_processor.cerebras.chat") as chat:
            with open(path, "rb") as fh:
                upload = mock.Mock(name="upload")
                upload.name = "scan.pdf"
                upload.chunks = lambda chunk_size=8192: iter([fh.read()])
                content, error = self.processor.extract_content_from_media(document_file=upload)
        chat.assert_not_called()
        self.assertIsNone(content)
        self.assertIn("has 3 pages; we can read up to 2 scanned pages", error)

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_too_many_scanned_pages_in_mixed_pdf_gives_a_clear_error(self):
        path = self.pdf(5)
        layer = [
            "Page one has plenty of selectable text for this threshold.",
            "",
            "",
            "Page four also has enough selectable text in the layer.",
            "",
        ]
        with mock.patch.object(MediaProcessor, "_pdf_text_layer", return_value=layer), \
                mock.patch.object(MediaProcessor, "MAX_SCANNED_PDF_PAGES", 2), \
                mock.patch("utils.media_processor.cerebras.chat") as chat:
            with self.assertRaisesMessage(Exception, "has 3 scanned/image-only pages"):
                self.processor._extract_text_from_document(path, ".pdf")
        chat.assert_not_called()

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_failed_batches(self):
        path = self.pdf(5)
        replies = iter(["ok text", cerebras.CerebrasError("HTTP 500")])

        def chat(*a, **k):
            r = next(replies)
            if isinstance(r, Exception):
                raise r
            return r
        with mock.patch.object(MediaProcessor, "PDF_VISION_WORKERS", 1), \
                mock.patch("utils.media_processor.cerebras.chat", side_effect=chat):
            text = self.processor._extract_text_from_document(path, ".pdf")
        self.assertIn("ok text", text)
        self.assertIn("[Page(s) 5 could not be read]", text)

        with mock.patch("utils.media_processor.cerebras.chat", side_effect=cerebras.CerebrasError("HTTP 500")):
            with self.assertRaisesMessage(Exception, "Could not read the scanned pages"):
                self.processor._extract_text_from_document(path, ".pdf")

    def test_without_cerebras_gemini_reads_the_pdf(self):
        path = self.pdf(2)
        self.gemini.llm.invoke.return_value = mock.Mock(content="gemini transcription")
        with mock.patch.dict(os.environ, {"CEREBRAS_API_KEY": ""}), \
                mock.patch("utils.media_processor.cerebras.chat") as chat:
            text = self.processor._extract_text_from_document(path, ".pdf")
        self.assertEqual(text, "gemini transcription")
        chat.assert_not_called()


class YouTubeTests(SimpleTestCase):
    URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    def setUp(self):
        self.gemini = mock.Mock()
        self.text = mock.Mock()
        self.service = LearningService(self.gemini, self.text)

    def transcript(self, text=None, error=None):
        return mock.patch("learning.learning_service.get_youtube_transcript", return_value=(text, error))

    def test_transcript_is_summarised_on_the_text_model(self):
        self.text.run_prompt.return_value = "  A summary.  "
        with self.transcript("hello world transcript"):
            result = self.service.summarize_from_url(self.URL)
        self.assertEqual(result["summary"], "A summary.")
        self.assertEqual(result["transcript"], "hello world transcript")
        self.assertIn("hello world transcript", self.text.run_prompt.call_args.args[1])
        self.gemini.llm.invoke.assert_not_called()

    def test_mindmap_flashcards_and_quiz_from_transcript(self):
        mindmap = {"name": "Topic", "children": [{"name": "Sub", "children": ["leaf as a string"]}]}
        cards = [{"front": "Q", "back": "A"}]
        self.text.run_prompt.side_effect = [json.dumps(mindmap), "```json\n" + json.dumps(cards) + "\n```"]
        quiz = [{"question": "Q?", "options": ["a", "b", "c", "d"], "correct_answer": "B", "explanation": ""}]
        self.text.llm.with_structured_output.side_effect = RuntimeError("no tools")
        self.text.run_raw.return_value = json.dumps(quiz)
        with self.transcript("the transcript"):
            mm = self.service.mindmap_from_url(self.URL)["mindmap"]
            self.assertEqual(mm.children[0].children[0].name, "leaf as a string")
            self.assertEqual(self.service.flashcards_from_url(self.URL)["total_cards"], 1)
            result = self.service.mcq_from_url(self.URL, 1)
        self.assertTrue(result["success"])
        self.assertEqual(result["quiz"][0].correct_answer, "B")
        self.assertIn("the transcript", self.text.run_raw.call_args.args[0])
        self.gemini.llm.invoke.assert_not_called()

    def test_without_a_transcript_gemini_watches_the_video(self):
        self.gemini.llm.invoke.return_value = mock.Mock(content="Narrator: today we learn about cells.")
        self.text.run_prompt.return_value = "Summary of the video."
        with self.transcript(error="YouTube blocked our request for the transcript."):
            result = self.service.summarize_from_url(self.URL)
        self.assertEqual(result, {"success": True, "summary": "Summary of the video.", "source": "gemini_video"})
        # The URL goes to Gemini as a video part (not as text it would have to guess from)...
        video = self.gemini.llm.invoke.call_args.args[0][1].content[1]
        self.assertEqual(video, {"type": "media", "file_uri": self.URL, "mime_type": "video/mp4"})
        # ...and the text it returns is summarised on the text model.
        self.assertIn("today we learn about cells", self.text.run_prompt.call_args.args[1])

    def test_readable_error_when_neither_works(self):
        self.gemini.llm.invoke.side_effect = Exception("429 RESOURCE_EXHAUSTED. {'error': ...}")
        with self.transcript(error="YouTube blocked our request for the transcript (this happens from cloud servers)."):
            result = self.service.flashcards_from_url(self.URL)
        self.assertFalse(result["success"])
        self.assertIn("Couldn't read this YouTube video. YouTube blocked our request", result["error"])
        self.assertIn("over its usage limit", result["error"])
        self.assertIn("pasting the video's transcript", result["error"])
        self.text.run_prompt.assert_not_called()

    def test_gemini_only_variant_does_not_refetch(self):
        self.gemini.llm.invoke.return_value = mock.Mock(content="video text")
        self.text.run_prompt.return_value = "S"
        with self.transcript("should not be used") as fetch:
            result = self.service.summarize_from_url_with_gemini(self.URL, "no captions")
        fetch.assert_not_called()
        self.assertEqual(result["summary"], "S")

    def test_transcript_fetch_errors_are_readable(self):
        from youtube_transcript_api import RequestBlocked
        from utils import youtube
        api = mock.Mock()
        api.list.side_effect = RequestBlocked("dQw4w9WgXcQ")
        with mock.patch.object(youtube, "_transcript_api", return_value=api):
            text, error = youtube.get_youtube_transcript(self.URL)
        self.assertIsNone(text)
        self.assertIn("YouTube blocked our request", error)

    def test_transcript_text_is_joined(self):
        from utils import youtube
        snippet = lambda t: mock.Mock(text=t)
        transcript = mock.Mock()
        transcript.fetch.return_value = [snippet("hello"), snippet("world")]
        tlist = mock.Mock()
        tlist.find_manually_created_transcript.return_value = transcript
        api = mock.Mock()
        api.list.return_value = tlist
        with mock.patch.object(youtube, "_transcript_api", return_value=api):
            self.assertEqual(youtube.get_youtube_transcript("https://youtu.be/dQw4w9WgXcQ"), ("hello world", None))
        api.list.assert_called_once_with("dQw4w9WgXcQ")


class ExplainerFrameReviewTests(SimpleTestCase):
    def setUp(self):
        from explainer.pipeline import ExplainerPipeline
        self.tmp = tempfile.TemporaryDirectory()
        with mock.patch.dict(os.environ, {"GOOGLE_API_KEY": "test"}):
            self.pipeline = ExplainerPipeline(self.tmp.name)
        self.frames = []
        for i in range(3):
            fp = os.path.join(self.tmp.name, f"f{i}.png")
            Image.new("RGB", (64, 36), "blue").save(fp)
            self.frames.append(fp)

    def tearDown(self):
        self.tmp.cleanup()

    @mock.patch.dict(os.environ, WITH_CEREBRAS)
    def test_frames_go_to_qwen_as_image_url(self):
        verdict = {"score": 8, "verdict": "good", "issues": []}
        with mock.patch("explainer.pipeline.cerebras.chat", return_value=json.dumps(verdict)) as chat, \
                mock.patch.object(self.pipeline, "_generate") as gemini:
            report = self.pipeline.visual_critique("A brief", self.frames)
        self.assertEqual(report, verdict)
        gemini.assert_not_called()
        content = chat.call_args.args[0]
        self.assertTrue(chat.call_args.kwargs["json_mode"])
        self.assertEqual(len(image_parts(content)), 3)
        self.assertTrue(image_parts(content)[0]["image_url"]["url"].startswith("data:image/png;base64,"))

    def test_without_cerebras_frames_go_to_gemini(self):
        with mock.patch.dict(os.environ, {"CEREBRAS_API_KEY": ""}), \
                mock.patch("explainer.pipeline.cerebras.chat") as chat, \
                mock.patch.object(self.pipeline, "_generate",
                                  return_value=mock.Mock(text='{"score": 5, "verdict": "revise", "issues": ["x"]}')):
            report = self.pipeline.visual_critique("A brief", self.frames)
        chat.assert_not_called()
        self.assertEqual(report["verdict"], "revise")
