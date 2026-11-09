"""
LTI 1.3 + library tests.

The LTI tests play the part of a real LMS: they hold a platform RSA key, run the
OIDC login, sign id_tokens, and let PyLTI1p3 do its full validation (signature,
nonce, state, deployment). Only the platform's outbound HTTP (token + score
endpoints) is mocked.
"""
import json
import time
import uuid
from unittest import mock
from urllib.parse import parse_qs, urlparse

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from pylti1p3.contrib.django.lti1p3_tool_config.models import LtiTool
from pylti1p3.registration import Registration

from library.models import LearningResource, QuizAttempt, ResourceAccess
from users.auth import create_tokens
from users.services import get_role, set_role

from .management.commands.lti_setup import ensure_key
from .models import LtiLaunch, LtiResourceLink, LtiUserLink

ISS = "https://lms.example.edu"
CLIENT_ID = "learnable-client"
DEPLOYMENT = "dep-1"
LINEITEM = "https://lms.example.edu/api/lti/courses/7/lineitems/42"
INSTRUCTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"
LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"
QUIZ = {"quiz": [
    {"question": "2+2?", "options": ["3", "4", "5", "6"], "correct_answer": "B", "explanation": "math"},
    {"question": "Sky?", "options": ["green", "red", "blue", "black"], "correct_answer": "C", "explanation": ""},
]}


def auth(user):
    return {"HTTP_AUTHORIZATION": "Bearer " + create_tokens(user.id, user.username)[0]}


@override_settings(FRONTEND_URL="http://frontend.test", ALLOWED_HOSTS=["testserver"])
class LtiFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.platform_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pub_pem = cls.platform_key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        jwk = dict(Registration.get_jwk(pub_pem))
        cls.kid = jwk["kid"]
        cls.tool_key = ensure_key()
        LtiTool.objects.create(
            title="Test LMS", issuer=ISS, client_id=CLIENT_ID,
            auth_login_url=f"{ISS}/auth", auth_token_url=f"{ISS}/token",
            key_set=json.dumps({"keys": [jwk]}), tool_key=cls.tool_key,
            deployment_ids=json.dumps([DEPLOYMENT]),
        )
        cls.teacher = User.objects.create_user("teacher", "t@example.edu", "pw-123456")
        cls.quiz = LearningResource.objects.create(owner=cls.teacher, type="quiz", title="Arithmetic", payload=QUIZ)

    # ── helpers acting as the LMS ─────────────────────────────────────

    def _login(self):
        r = self.client.get("/lti/login/", {
            "iss": ISS, "client_id": CLIENT_ID, "login_hint": "hint",
            "target_link_uri": "http://testserver/lti/launch/", "lti1p3_new_window": "1",
        })
        self.assertEqual(r.status_code, 302, r.content[:300])
        q = parse_qs(urlparse(r["Location"]).query)
        self.assertEqual(q["redirect_uri"], ["http://testserver/lti/launch/"])
        return q["state"][0], q["nonce"][0]

    def _launch(self, claims: dict, sub="student-1", roles=(LEARNER,)):
        state, nonce = self._login()
        now = int(time.time())
        body = {
            "iss": ISS, "aud": CLIENT_ID, "sub": sub, "iat": now, "exp": now + 300, "nonce": nonce,
            "email": f"{sub}@example.edu", "given_name": "Sam",
            "https://purl.imsglobal.org/spec/lti/claim/deployment_id": DEPLOYMENT,
            "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
            "https://purl.imsglobal.org/spec/lti/claim/roles": list(roles),
            "https://purl.imsglobal.org/spec/lti/claim/context": {"id": "c7", "title": "Biology 101"},
            **claims,
        }
        token = jwt.encode(body, self.platform_key, algorithm="RS256", headers={"kid": self.kid})
        return self.client.post("/lti/launch/", {"id_token": token, "state": state})

    def _resource_claims(self, resource_link_id="rl-1", ags=True):
        claims = {
            "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
            "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "http://testserver/lti/launch/",
            "https://purl.imsglobal.org/spec/lti/claim/resource_link": {"id": resource_link_id},
            "https://purl.imsglobal.org/spec/lti/claim/custom": {"resource_id": str(self.quiz.id)},
        }
        if ags:
            claims["https://purl.imsglobal.org/spec/lti-ags/claim/endpoint"] = {
                "scope": ["https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
                          "https://purl.imsglobal.org/spec/lti-ags/scope/score"],
                "lineitem": LINEITEM,
            }
        return claims

    def _code_from(self, response):
        self.assertEqual(response.status_code, 302, response.content[:300])
        loc = urlparse(response["Location"])
        self.assertEqual(f"{loc.scheme}://{loc.netloc}{loc.path}", "http://frontend.test/lti")
        return parse_qs(loc.query)["code"][0]

    def _exchange(self, code):
        return self.client.post("/api/lti/exchange", {"code": code}, content_type="application/json").json()

    # ── tests ─────────────────────────────────────────────────────────

    def test_student_launch_signs_in_and_grants_access(self):
        code = self._code_from(self._launch(self._resource_claims()))
        data = self._exchange(code)
        self.assertEqual(data["launch"]["mode"], "view")
        self.assertEqual(data["launch"]["resource_id"], str(self.quiz.id))
        self.assertEqual(data["launch"]["context_title"], "Biology 101")
        self.assertFalse(data["launch"]["is_instructor"])

        student = User.objects.get(lti_links__issuer=ISS, lti_links__sub="student-1")
        self.assertFalse(student.has_usable_password())
        self.assertTrue(ResourceAccess.objects.filter(user=student, resource=self.quiz).exists())
        self.assertTrue(LtiResourceLink.objects.filter(issuer=ISS, resource_link_id="rl-1").exists())

        # The app token works, and the student gets questions without the answer key.
        me = self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION="Bearer " + data["access"])
        self.assertEqual(me.status_code, 200)
        r = self.client.get(f"/api/library/resources/{self.quiz.id}", HTTP_AUTHORIZATION="Bearer " + data["access"]).json()
        self.assertNotIn("correct_answer", r["resource"]["payload"]["quiz"][0])

    def test_same_lms_user_maps_to_same_account(self):
        self._exchange(self._code_from(self._launch(self._resource_claims())))
        self._exchange(self._code_from(self._launch(self._resource_claims())))
        self.assertEqual(LtiUserLink.objects.filter(issuer=ISS, sub="student-1").count(), 1)

    def test_launch_code_is_single_use(self):
        code = self._code_from(self._launch(self._resource_claims()))
        self.assertIn("access", self._exchange(code))
        self.assertIn("error", self._exchange(code))
        self.assertIn("error", self._exchange("not-a-real-code"))

    def test_launch_code_expires(self):
        code = self._code_from(self._launch(self._resource_claims()))
        LtiLaunch.objects.update(code_expires_at="2000-01-01T00:00:00Z")
        self.assertIn("error", self._exchange(code))

    def test_forged_launch_is_rejected(self):
        state, nonce = self._login()
        attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = int(time.time())
        token = jwt.encode({"iss": ISS, "aud": CLIENT_ID, "sub": "x", "iat": now, "exp": now + 300,
                            "nonce": nonce, **self._resource_claims()},
                           attacker_key, algorithm="RS256", headers={"kid": self.kid})
        r = self.client.post("/lti/launch/", {"id_token": token, "state": state})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(LtiLaunch.objects.exists())

    def test_learner_cannot_deep_link(self):
        r = self._launch(self._deep_link_claims(), sub="student-9", roles=(LEARNER,))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(get_role(User.objects.get(lti_links__sub="student-9")), "student")

    def _deep_link_claims(self):
        return {
            "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingRequest",
            "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings": {
                "deep_link_return_url": f"{ISS}/deep_link_return",
                "accept_types": ["ltiResourceLink"],
                "accept_presentation_document_targets": ["iframe", "window"],
            },
        }

    def test_instructor_deep_link_returns_signed_content_item_with_gradebook_column(self):
        data = self._exchange(self._code_from(self._launch(self._deep_link_claims(), sub="teacher-lms",
                                                           roles=(INSTRUCTOR,))))
        self.assertEqual(data["launch"]["mode"], "pick")
        lms_teacher = User.objects.get(lti_links__sub="teacher-lms")
        self.assertEqual(get_role(lms_teacher), "teacher")  # LMS instructors become teachers
        own =LearningResource.objects.create(owner=lms_teacher, type="quiz", title="Cells quiz", payload=QUIZ)
        hdr = {"HTTP_AUTHORIZATION": "Bearer " + data["access"]}

        # Can't publish someone else's resource
        bad = self.client.post("/api/lti/deep-link", {"launch_id": data["launch"]["id"], "resource_id": str(self.quiz.id)},
                               content_type="application/json", **hdr).json()
        self.assertIn("error", bad)

        res = self.client.post("/api/lti/deep-link", {"launch_id": data["launch"]["id"], "resource_id": str(own.id)},
                               content_type="application/json", **hdr).json()
        self.assertEqual(res["return_url"], f"{ISS}/deep_link_return")
        tool_pub = serialization.load_pem_public_key(self.tool_key.public_key.encode())
        msg = jwt.decode(res["jwt"], tool_pub, algorithms=["RS256"], audience=ISS)
        self.assertEqual(msg["https://purl.imsglobal.org/spec/lti/claim/message_type"], "LtiDeepLinkingResponse")
        item = msg["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"][0]
        self.assertEqual(item["url"], "http://testserver/lti/launch/")
        self.assertEqual(item["custom"], {"resource_id": str(own.id)})
        self.assertEqual(item["lineItem"]["scoreMaximum"], 2)

    def test_quiz_attempt_is_graded_server_side_and_sent_to_gradebook(self):
        data = self._exchange(self._code_from(self._launch(self._resource_claims())))
        hdr = {"HTTP_AUTHORIZATION": "Bearer " + data["access"]}

        calls = []

        def fake_post(url, data=None, headers=None, **kw):
            calls.append((url, data, headers))
            resp = mock.Mock(ok=True, status_code=200, headers={})
            resp.raise_for_status = lambda: None
            resp.json.return_value = {"access_token": "platform-token", "expires_in": 3600} if url.endswith("/token") else {}
            resp.text = "{}"
            return resp

        with mock.patch("requests.Session.post", side_effect=fake_post):
            # Client claims a perfect score, but only one answer is actually right.
            r = self.client.post(f"/api/library/resources/{self.quiz.id}/attempts",
                                 {"answers": ["4", "green"], "lti_launch_id": data["launch"]["id"]},
                                 content_type="application/json", **hdr).json()

        self.assertEqual((r["score"], r["max_score"]), (1, 2))
        self.assertTrue(r["grade_synced"], r.get("grade_sync_error"))
        score_call = next(c for c in calls if c[0] == f"{LINEITEM}/scores")
        sent = json.loads(score_call[1])
        self.assertEqual((sent["scoreGiven"], sent["scoreMaximum"], sent["userId"]), (1, 2, "student-1"))
        self.assertEqual(score_call[2]["Authorization"], "Bearer platform-token")
        self.assertTrue(QuizAttempt.objects.get().grade_synced)

    def test_attempt_with_someone_elses_launch_is_not_synced(self):
        data = self._exchange(self._code_from(self._launch(self._resource_claims())))
        other = User.objects.create_user("other", "o@x.com", "pw-123456")
        ResourceAccess.objects.create(user=other, resource=self.quiz, granted_via="link")
        r = self.client.post(f"/api/library/resources/{self.quiz.id}/attempts",
                             {"answers": ["4", "blue"], "lti_launch_id": data["launch"]["id"]},
                             content_type="application/json", **auth(other)).json()
        self.assertEqual(r["score"], 2)
        self.assertFalse(r["grade_synced"])

    def test_jwks_and_config_endpoints(self):
        keys = self.client.get("/lti/jwks/").json()["keys"]
        self.assertTrue(any(k.get("kid") for k in keys))
        cfg = self.client.get("/lti/config/").json()
        self.assertEqual(cfg["launch_url"], "http://testserver/lti/launch/")


class LibraryTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", "o@example.com", "pw-123456")
        set_role(self.owner, "teacher")  # only teachers can save/share to a class
        self.other = User.objects.create_user("other", "x@example.com", "pw-123456")

    def test_save_list_and_private_by_default(self):
        r = self.client.post("/api/library/resources", {"type": "quiz", "title": "Q", "payload": QUIZ},
                             content_type="application/json", **auth(self.owner)).json()
        rid = r["resource"]["id"]
        self.assertEqual(len(self.client.get("/api/library/resources", **auth(self.owner)).json()["resources"]), 1)
        self.assertEqual(len(self.client.get("/api/library/resources", **auth(self.other)).json()["resources"]), 0)
        self.assertEqual(self.client.get(f"/api/library/resources/{rid}", **auth(self.other)).status_code, 404)
        self.assertEqual(self.client.get(f"/api/library/resources/{rid}").status_code, 401)

    def test_sharing_link_opens_for_signed_in_users_without_answer_key(self):
        res = LearningResource.objects.create(owner=self.owner, type="quiz", title="Q", payload=QUIZ)
        # Only the owner can turn sharing on
        self.assertEqual(self.client.patch(f"/api/library/resources/{res.id}/sharing", {"share_enabled": True},
                                           content_type="application/json", **auth(self.other)).status_code, 404)
        self.client.patch(f"/api/library/resources/{res.id}/sharing", {"share_enabled": True},
                          content_type="application/json", **auth(self.owner))
        got = self.client.get(f"/api/library/resources/{res.id}", **auth(self.other)).json()["resource"]
        self.assertNotIn("correct_answer", got["payload"]["quiz"][0])
        owner_view = self.client.get(f"/api/library/resources/{res.id}", **auth(self.owner)).json()["resource"]
        self.assertEqual(owner_view["payload"]["quiz"][0]["correct_answer"], "B")

    def test_rejects_bad_type_empty_quiz_and_foreign_video(self):
        h = auth(self.owner)
        post = lambda body: self.client.post("/api/library/resources", body, content_type="application/json", **h).json()
        self.assertIn("error", post({"type": "essay", "title": "x", "payload": {}}))
        self.assertIn("error", post({"type": "quiz", "title": "x", "payload": {"quiz": []}}))
        with mock.patch("library.api.explainer_jobs.get_job", return_value={"id": "a" * 32, "user_id": self.other.id, "has_video": True}):
            self.assertIn("error", post({"type": "video", "title": "v", "explainer_job_id": "a" * 32}))
        with mock.patch("library.api.explainer_jobs.get_job",
                        return_value={"id": "a" * 32, "user_id": self.owner.id, "has_video": True, "title": "T", "transcript": []}):
            self.assertTrue(post({"type": "video", "title": "v", "explainer_job_id": "a" * 32})["success"])

    def test_google_login_only_reuses_google_created_accounts(self):
        info = {"email": "x@example.com", "email_verified": True, "given_name": "X"}
        with override_settings(GOOGLE_OAUTH_CLIENT_ID="cid"), \
                mock.patch("google.oauth2.id_token.verify_oauth2_token", return_value=info):
            r1 = self.client.post("/api/users/auth/google", {"credential": "tok"}, content_type="application/json").json()
            r2 = self.client.post("/api/users/auth/google", {"credential": "tok"}, content_type="application/json").json()
        uid = lambda t: int(jwt.decode(t, options={"verify_signature": False})["sub"])
        # Existing password account with the same (unverified) email is NOT taken over...
        self.assertNotEqual(uid(r1["access"]), self.other.id)
        # ...but the Google-created account is reused on the next sign-in.
        self.assertEqual(uid(r1["access"]), uid(r2["access"]))
