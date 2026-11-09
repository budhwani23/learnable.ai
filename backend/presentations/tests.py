import base64
import io
import json
from unittest import mock

from django.test import Client, SimpleTestCase

from core import bedrock_images
from core.bedrock_images import BedrockImageService, aspect_ratio_for_size

PNG = b"\x89PNG\r\n\x1a\nfake"
URL = "/api/presentations/image-proxy/v1/images/generations"


class FakeBedrock:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def invoke_model(self, **kwargs):
        self.calls.append(kwargs)
        return {"body": io.BytesIO(json.dumps(self.payload).encode())}


def ok_payload():
    return {"images": [base64.b64encode(PNG).decode()], "finish_reasons": [None], "seeds": [1]}


class AspectRatioTests(SimpleTestCase):
    def test_maps_sizes(self):
        self.assertEqual(aspect_ratio_for_size("1024x1024"), "1:1")
        self.assertEqual(aspect_ratio_for_size("1536x1024"), "3:2")
        self.assertEqual(aspect_ratio_for_size("1920x1080"), "16:9")
        self.assertEqual(aspect_ratio_for_size("1024x1536"), "2:3")
        self.assertEqual(aspect_ratio_for_size(None), "1:1")
        self.assertEqual(aspect_ratio_for_size("bogus"), "1:1")


class ServiceTests(SimpleTestCase):
    def test_request_body_and_decode(self):
        fake = FakeBedrock(ok_payload())
        svc = BedrockImageService(model_id="stability.stable-image-core-v1:1", client=fake)
        img = svc.generate("an owl", size="1920x1080")
        self.assertEqual(img.data, PNG)
        call = fake.calls[0]
        self.assertEqual(call["modelId"], "stability.stable-image-core-v1:1")
        self.assertEqual(json.loads(call["body"]),
                         {"prompt": "an owl", "aspect_ratio": "16:9", "output_format": "png"})

    def test_content_filter(self):
        fake = FakeBedrock({"images": [], "finish_reasons": ["Filter reason: prompt"]})
        svc = BedrockImageService(client=fake)
        with self.assertRaises(bedrock_images.ImageFilteredError):
            svc.generate("x")


@mock.patch.dict("os.environ", {"PRESENTON_IMAGE_PROXY_KEY": "secret"})
class EndpointTests(SimpleTestCase):
    def setUp(self):
        self.fake = FakeBedrock(ok_payload())
        patcher = mock.patch("presentations.image_proxy.get_image_service",
                             return_value=BedrockImageService(client=self.fake))
        patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, body, key="secret"):
        return Client().post(URL, data=json.dumps(body), content_type="application/json",
                             HTTP_AUTHORIZATION=f"Bearer {key}")

    def test_openai_shape(self):
        r = self.post({"model": "bedrock", "prompt": "an owl", "n": 1, "size": "1024x1024"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(base64.b64decode(r.json()["data"][0]["b64_json"]), PNG)

    def test_rejects_bad_key(self):
        self.assertEqual(self.post({"prompt": "x"}, key="wrong").status_code, 401)
        self.assertEqual(self.fake.calls, [])

    def test_filtered_falls_back_to_placeholder(self):
        self.fake.payload = {"images": [], "finish_reasons": ["Filter reason: output"]}
        r = self.post({"prompt": "x", "size": "1536x1024"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["model"], "placeholder")
        self.assertTrue(base64.b64decode(r.json()["data"][0]["b64_json"]).startswith(b"\x89PNG"))

    @mock.patch.dict("os.environ", {"PRESENTATION_IMAGE_PLACEHOLDER": "false"})
    def test_filtered_is_400_without_placeholder(self):
        self.fake.payload = {"images": [], "finish_reasons": ["Filter reason: output"]}
        r = self.post({"prompt": "x"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["type"], "content_policy_violation")
