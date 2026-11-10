import base64
import json
from unittest import mock

from django.test import Client, SimpleTestCase

from core import nvidia_images
from core.nvidia_images import NvidiaImageService, aspect_ratio_for_size, dimensions_for_ratio

JPEG = b"\xff\xd8\xff\xe0fake-jpeg"
URL = "/api/presentations/image-proxy/v1/images/generations"


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.ok = status < 400
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeNvidia:
    """Stands in for `requests`: records POSTs and returns a canned response."""

    def __init__(self, payload, status=200):
        self.payload, self.status = payload, status
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return FakeResponse(self.payload, self.status)


def ok_payload():
    return {"artifacts": [{"base64": base64.b64encode(JPEG).decode(), "finishReason": "SUCCESS", "seed": 0}]}


class AspectRatioTests(SimpleTestCase):
    def test_maps_sizes(self):
        self.assertEqual(aspect_ratio_for_size("1024x1024"), "1:1")
        self.assertEqual(aspect_ratio_for_size("1536x1024"), "3:2")
        self.assertEqual(aspect_ratio_for_size("1920x1080"), "16:9")
        self.assertEqual(aspect_ratio_for_size("1024x1536"), "2:3")
        self.assertEqual(aspect_ratio_for_size(None), "1:1")
        self.assertEqual(aspect_ratio_for_size("bogus"), "1:1")

    def test_dimensions_are_multiples_of_64(self):
        self.assertEqual(dimensions_for_ratio("1:1"), (1024, 1024))
        self.assertEqual(dimensions_for_ratio("16:9"), (1024, 576))
        self.assertEqual(dimensions_for_ratio("2:3"), (704, 1024))
        for ratio in ("21:9", "4:5", "9:16"):
            w, h = dimensions_for_ratio(ratio)
            self.assertEqual((w % 64, h % 64), (0, 0))


class ServiceTests(SimpleTestCase):
    def test_request_body_and_decode(self):
        fake = FakeNvidia(ok_payload())
        svc = NvidiaImageService(model_id="flux-3-image-klein", api_key="nvapi-test", session=fake)
        img = svc.generate("an owl", size="1920x1080")
        self.assertEqual(img.data, JPEG)
        self.assertEqual(img.mime_type, "image/jpeg")
        call = fake.calls[0]
        self.assertEqual(call["url"], "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux-3-image-klein")
        self.assertEqual(call["headers"]["Authorization"], "Bearer nvapi-test")
        self.assertEqual(call["json"], {"prompt": "an owl", "width": 1024, "height": 576, "seed": 0,
                                        "steps": svc.steps})

    def test_content_filter(self):
        fake = FakeNvidia({"artifacts": [{"base64": "", "finishReason": "CONTENT_FILTERED"}]})
        svc = NvidiaImageService(api_key="nvapi-test", session=fake)
        with self.assertRaises(nvidia_images.ImageFilteredError):
            svc.generate("x")

    def test_http_error(self):
        svc = NvidiaImageService(api_key="nvapi-test", session=FakeNvidia({"detail": "Unauthorized"}, status=401))
        with self.assertRaises(nvidia_images.ImageGenerationError):
            svc.generate("x")

    def test_missing_key_never_calls_api(self):
        fake = FakeNvidia(ok_payload())
        with self.assertRaises(nvidia_images.ImageGenerationError):
            NvidiaImageService(api_key="", session=fake).generate("x")
        self.assertEqual(fake.calls, [])


@mock.patch.dict("os.environ", {"PRESENTON_IMAGE_PROXY_KEY": "secret"})
class EndpointTests(SimpleTestCase):
    def setUp(self):
        self.fake = FakeNvidia(ok_payload())
        patcher = mock.patch("presentations.image_proxy.get_image_service",
                             return_value=NvidiaImageService(api_key="nvapi-test", session=self.fake))
        patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, body, key="secret"):
        return Client().post(URL, data=json.dumps(body), content_type="application/json",
                             HTTP_AUTHORIZATION=f"Bearer {key}")

    def test_openai_shape(self):
        r = self.post({"model": "nvidia", "prompt": "an owl", "n": 1, "size": "1024x1024"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(base64.b64decode(r.json()["data"][0]["b64_json"]), JPEG)

    def test_rejects_bad_key(self):
        self.assertEqual(self.post({"prompt": "x"}, key="wrong").status_code, 401)
        self.assertEqual(self.fake.calls, [])

    def test_filtered_falls_back_to_placeholder(self):
        self.fake.payload = {"artifacts": [{"base64": "", "finishReason": "CONTENT_FILTERED"}]}
        r = self.post({"prompt": "x", "size": "1536x1024"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["model"], "placeholder")
        self.assertTrue(base64.b64decode(r.json()["data"][0]["b64_json"]).startswith(b"\x89PNG"))

    def test_upstream_error_falls_back_to_placeholder(self):
        self.fake.status, self.fake.payload = 503, {"detail": "busy"}
        r = self.post({"prompt": "x"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["model"], "placeholder")

    @mock.patch.dict("os.environ", {"PRESENTATION_IMAGE_PLACEHOLDER": "false"})
    def test_filtered_is_400_without_placeholder(self):
        self.fake.payload = {"artifacts": [{"base64": "", "finishReason": "CONTENT_FILTERED"}]}
        r = self.post({"prompt": "x"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["type"], "content_policy_violation")


class PresentonRetryTests(SimpleTestCase):
    """Presenton fails a whole deck when the LLM streams a cut-off slide; we retry it."""

    BAD = FakeResponse({"detail": "Unterminated string starting at: line 6 column 23 (char 73)"}, 500)
    GOOD = FakeResponse({"presentation_id": "p1", "path": "/app_data/exports/p1.pptx"})

    def generate(self, responses):
        from presentations import client
        with mock.patch.object(client.requests, "post", side_effect=responses) as post, \
                mock.patch.object(client.time, "sleep"):
            try:
                return client.generate("text", instructions=None, n_slides=5, template="general",
                                       tone="educational"), post.call_count
            except client.PresentonError as e:
                return e, post.call_count

    def test_malformed_slide_json_is_retried(self):
        result, calls = self.generate([self.BAD, self.GOOD])
        self.assertEqual(result["presentation_id"], "p1")
        self.assertEqual(calls, 2)

    def test_gives_up_with_a_friendly_message(self):
        result, calls = self.generate([self.BAD, self.BAD, self.BAD])
        self.assertEqual(calls, 3)
        self.assertIn("incomplete slide", str(result))

    def test_empty_llm_reply_is_retried(self):
        empty = FakeResponse({"detail": "LLM did not return any content"}, 400)
        result, calls = self.generate([empty, self.GOOD])
        self.assertEqual((result["presentation_id"], calls), ("p1", 2))

    def test_other_server_errors_are_not_retried(self):
        result, calls = self.generate([FakeResponse({"detail": "Template not found"}, 500)])
        self.assertEqual(calls, 1)
        self.assertIn("Template not found", str(result))
