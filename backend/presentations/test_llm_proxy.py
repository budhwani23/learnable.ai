"""The OpenAI-compatible slide-text endpoint Presenton calls (Cerebras mocked)."""
import json
import os
from unittest import mock

from django.test import Client, SimpleTestCase

URL = "/api/presentations/llm-proxy/v1/chat/completions"
ENV = {"PRESENTON_IMAGE_PROXY_KEY": "proxy-key", "CEREBRAS_API_KEY": "test", "CEREBRAS_MODEL": "qwen-3.8-27b"}
SCHEMA = {"type": "json_schema", "json_schema": {"name": "slide", "schema": {"type": "object"}, "strict": True}}


def completion(content, finish="stop", tool_calls=None):
    message = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {"id": "chatcmpl-1", "created": 1, "model": "qwen-3.8-27b",
            "choices": [{"index": 0, "message": message, "finish_reason": finish}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}


def sse_chunks(resp):
    lines = [l[len("data: "):] for l in resp.content.decode().split("\n\n") if l.startswith("data: ")]
    assert lines[-1] == "[DONE]"
    return [json.loads(l) for l in lines[:-1]]


@mock.patch.dict(os.environ, ENV)
class LlmProxyTests(SimpleTestCase):
    def post(self, body, key="proxy-key"):
        return Client().post(URL, data=json.dumps(body), content_type="application/json",
                             HTTP_AUTHORIZATION=f"Bearer {key}")

    def test_rejects_bad_key(self):
        self.assertEqual(self.post({"messages": [{"role": "user", "content": "x"}]}, key="nope").status_code, 401)

    def test_lists_the_model(self):
        resp = Client().get("/api/presentations/llm-proxy/v1/models", HTTP_AUTHORIZATION="Bearer proxy-key")
        self.assertEqual(resp.json()["data"][0]["id"], "qwen-3.8-27b")

    def test_stream_request_gets_valid_sse_from_a_non_streaming_call(self):
        with mock.patch("presentations.llm_proxy.cerebras.complete",
                        return_value=completion('```json\n{"title": "Cells"}\n```')) as complete:
            resp = self.post({"model": "whatever", "stream": True, "response_format": SCHEMA,
                              "messages": [{"role": "user", "content": "slide"}],
                              "enable_thinking": False, "stream_options": {"include_usage": True}})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "text/event-stream")
        payload = complete.call_args.args[0]
        self.assertNotIn("stream", payload)
        self.assertNotIn("enable_thinking", payload)
        self.assertEqual(payload["model"], "qwen-3.8-27b")
        self.assertFalse(payload["response_format"]["json_schema"]["strict"])  # Cerebras strict needs extra schema fields
        first, last = sse_chunks(resp)
        self.assertEqual(json.loads(first["choices"][0]["delta"]["content"]), {"title": "Cells"})
        self.assertEqual(last["choices"][0]["finish_reason"], "stop")
        self.assertEqual(last["usage"]["total_tokens"], 15)

    def test_cut_off_or_empty_json_is_asked_again(self):
        replies = [completion('{"title": "Cel', finish="length"), completion(""), completion('{"title": "Cells"}')]
        with mock.patch("presentations.llm_proxy.cerebras.complete", side_effect=replies) as complete:
            resp = self.post({"stream": False, "response_format": SCHEMA,
                              "messages": [{"role": "user", "content": "slide"}]})
        self.assertEqual(complete.call_count, 3)
        self.assertEqual(json.loads(resp.json()["choices"][0]["message"]["content"]), {"title": "Cells"})

    def test_gives_up_with_503_so_the_client_retries(self):
        with mock.patch("presentations.llm_proxy.cerebras.complete", return_value=completion("")):
            resp = self.post({"response_format": SCHEMA, "messages": [{"role": "user", "content": "slide"}]})
        self.assertEqual(resp.status_code, 503)

    def test_plain_text_and_tool_calls_pass_through(self):
        call = {"id": "c1", "type": "function", "function": {"name": "search", "arguments": "{}"}}
        with mock.patch("presentations.llm_proxy.cerebras.complete",
                        return_value=completion(None, finish="tool_calls", tool_calls=[call])):
            resp = self.post({"stream": True, "tools": [{"type": "function", "function": {"name": "search"}}],
                              "response_format": SCHEMA, "messages": [{"role": "user", "content": "x"}]})
        delta = sse_chunks(resp)[0]["choices"][0]["delta"]
        self.assertEqual(delta["tool_calls"][0]["function"]["name"], "search")
        self.assertEqual(delta["tool_calls"][0]["index"], 0)
        with mock.patch("presentations.llm_proxy.cerebras.complete", return_value=completion("Just text")):
            resp = self.post({"messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(resp.json()["choices"][0]["message"]["content"], "Just text")
