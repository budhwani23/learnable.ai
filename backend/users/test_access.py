"""Waitlist gating, account blocking and per-resource credit limits."""
import json
import shutil
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings

from users import credits
from users.auth import create_tokens
from users.models import CreditAllowance, UsageEvent, UserProfile
from users.services import set_status


def auth(user):
    return {"HTTP_AUTHORIZATION": f"Bearer {create_tokens(user.id, user.username)[0]}"}


def post(client, url, body, user=None, token=None):
    headers = auth(user) if user else ({"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {})
    return client.post(url, data=json.dumps(body), content_type="application/json", **headers)


MINDMAP_OK = {"success": True, "mindmap": {"name": "Photosynthesis", "children": []}}


class WaitlistTests(TestCase):
    def setUp(self):
        self.client = Client()

    def register(self, username="newbie"):
        return post(self.client, "/api/users/auth/register",
                    {"username": username, "email": f"{username}@example.com", "password": "s3cret-pass"})

    def test_new_signup_lands_on_waitlist_and_is_blocked_from_the_app(self):
        r = self.register()
        self.assertEqual(r.status_code, 200)
        token = r.json()["access"]
        me = self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}").json()
        self.assertEqual(me["status"], "pending")
        self.assertFalse(me["is_admin"])

        with mock.patch("learning.api.learning_service.generate_mindmap", return_value=MINDMAP_OK) as gen:
            r = post(self.client, "/api/learning/generate-mindmap", {"topic": "x"}, token=token)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "waitlist")
        gen.assert_not_called()
        for url in ("/api/library/resources", "/api/explainer/jobs", "/api/presentations/options"):
            self.assertEqual(self.client.get(url, HTTP_AUTHORIZATION=f"Bearer {token}").status_code, 403, url)
        self.assertFalse(UsageEvent.objects.exists())

        # Pending users can still sign in (to see their waitlist screen).
        r = post(self.client, "/api/users/auth/login", {"username": "newbie", "password": "s3cret-pass"})
        self.assertEqual(r.status_code, 200)

        # Approved => the same token now works.
        set_status(User.objects.get(username="newbie"), UserProfile.STATUS_APPROVED)
        self.assertEqual(self.client.get("/api/library/resources", HTTP_AUTHORIZATION=f"Bearer {token}").status_code, 200)

    @override_settings(WAITLIST_ENABLED=False)
    def test_waitlist_can_be_switched_off(self):
        token = self.register("open1").json()["access"]
        me = self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}").json()
        self.assertEqual(me["status"], "approved")

    def test_existing_and_admin_created_users_are_approved(self):
        # Users not created through self sign-up (pre-launch accounts, LMS, admins) skip the waitlist.
        u = User.objects.create_user("legacy", password="x" * 10)
        self.assertEqual(u.profile.status, UserProfile.STATUS_APPROVED)

    def test_rejected_banned_and_deactivated_users_are_locked_out(self):
        u = User.objects.create_user("bad", password="s3cret-pass")
        token = create_tokens(u.id, u.username)
        set_status(u, UserProfile.STATUS_BANNED, "spam")
        r = post(self.client, "/api/users/auth/login", {"username": "bad", "password": "s3cret-pass"})
        self.assertEqual(r.status_code, 403)
        self.assertIn("banned", r.json()["detail"])
        self.assertIn("spam", r.json()["detail"])
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {"refresh": token[1]}).status_code, 401)
        r = self.client.get("/api/library/resources", HTTP_AUTHORIZATION=f"Bearer {token[0]}")
        self.assertEqual((r.status_code, r.json()["code"]), (403, "banned"))

        set_status(u, UserProfile.STATUS_REJECTED)
        self.assertEqual(post(self.client, "/api/users/auth/login",
                              {"username": "bad", "password": "s3cret-pass"}).status_code, 403)

        set_status(u, UserProfile.STATUS_APPROVED)
        u.is_active = False
        u.save()
        r = post(self.client, "/api/users/auth/login", {"username": "bad", "password": "s3cret-pass"})
        self.assertEqual(r.status_code, 403)
        self.assertIn("deactivated", r.json()["detail"])
        # Even /auth/me is refused for a deactivated account.
        r = self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION=f"Bearer {token[0]}")
        self.assertEqual((r.status_code, r.json()["code"]), (403, "account_deactivated"))


class CreditLimitTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user("learner", password="x" * 10)

    def me(self):
        return self.client.get("/api/users/auth/me", **auth(self.user)).json()

    def mindmap(self):
        return post(self.client, "/api/learning/generate-mindmap", {"topic": "Photosynthesis"}, self.user)

    def test_three_credits_per_resource_type_then_a_clean_402(self):
        with mock.patch("learning.api.learning_service.generate_mindmap", return_value=MINDMAP_OK) as gen:
            for _ in range(3):
                self.assertEqual(self.mindmap().status_code, 200)
            r = self.mindmap()
        self.assertEqual(gen.call_count, 3)  # the 4th never reached the AI
        self.assertEqual(r.status_code, 402)
        body = r.json()
        self.assertEqual(body["code"], "out_of_credits")
        self.assertEqual(body["resource_type"], "mindmap")
        self.assertIn("used all 3", body["detail"])
        credits_now = self.me()["credits"]
        self.assertEqual(credits_now["mindmap"], {"limit": 3, "used": 3, "remaining": 0})
        # Other resource types are independent.
        self.assertEqual(credits_now["quiz"]["remaining"], 3)

    def test_failed_generation_gives_the_credit_back(self):
        with mock.patch("learning.api.learning_service.generate_mindmap",
                        return_value={"success": False, "error": "Model failure"}):
            r = self.mindmap()
        self.assertGreaterEqual(r.status_code, 400)
        self.assertEqual(self.me()["credits"]["mindmap"]["remaining"], 3)
        self.assertTrue(UsageEvent.objects.get(user=self.user).refunded)

        with mock.patch("learning.api.learning_service.generate_mindmap", side_effect=RuntimeError("boom")):
            self.mindmap()
        self.assertEqual(self.me()["credits"]["mindmap"]["remaining"], 3)

    def test_bad_input_does_not_charge(self):
        r = self.client.post("/api/learning/summarize-content", {"data": "{}"}, **auth(self.user))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.me()["credits"]["summary"]["remaining"], 3)

    def test_video_and_slides_jobs_charge_on_start_and_refund_on_failure(self):
        from explainer.jobs import explainer_store
        from presentations.service import store as slides_store
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        for s in (explainer_store, slides_store):
            patcher = mock.patch.object(s, "root", tmp / s.kind)
            patcher.start()
            self.addCleanup(patcher.stop)

        with mock.patch("explainer.api.jobs.submit") as submit:
            for _ in range(3):
                r = self.client.post("/api/explainer/jobs", {"data": json.dumps({"text": "Explain gravity"})},
                                     **auth(self.user))
                self.assertEqual(r.status_code, 200, r.content)
            r = self.client.post("/api/explainer/jobs", {"data": json.dumps({"text": "Explain gravity"})},
                                 **auth(self.user))
            self.assertEqual((r.status_code, r.json()["code"]), (402, "out_of_credits"))
            self.assertEqual(submit.call_count, 3)
            # Missing input is rejected before any credit is used.
            r = self.client.post("/api/presentations/jobs", {"data": "{}"}, **auth(self.user))
            self.assertIn("error", r.json())
        self.assertEqual(self.me()["credits"]["slides"]["remaining"], 3)

        with mock.patch("presentations.api.store.submit") as submit:
            r = self.client.post("/api/presentations/jobs", {"data": json.dumps({"text": "Cells"})}, **auth(self.user))
            self.assertEqual(r.status_code, 200, r.content)
            runner = submit.call_args[0][1]
            job_id = r.json()["job"]["id"]
        self.assertEqual(self.me()["credits"]["slides"]["remaining"], 2)

        # The job is submitted through the refunding wrapper, not the bare runner.
        from presentations.service import run_presentation_job, store
        self.assertIsNot(runner, run_presentation_job)
        # A job that ends up failed (or crashes) gets its credit back, once.
        failing = credits.refund_if_job_failed(lambda jid: store.update(jid, status="failed"), store.get)
        failing(job_id)
        failing(job_id)
        self.assertEqual(self.me()["credits"]["slides"]["remaining"], 3)
        crashing = credits.refund_if_job_failed(mock.Mock(side_effect=RuntimeError("x")), store.get)
        with self.assertRaises(RuntimeError):
            crashing(job_id)  # already refunded: stays at 3, never above
        self.assertEqual(self.me()["credits"]["slides"]["remaining"], 3)

    def test_admin_top_up_and_concurrency_safe_counter(self):
        for _ in range(3):
            credits.consume(self.user, "quiz")
        with self.assertRaises(credits.OutOfCredits):
            credits.consume(self.user, "quiz")
        credits.grant(self.user, "quiz", 2)
        credits.consume(self.user, "quiz")
        a = CreditAllowance.objects.get(user=self.user, resource_type="quiz")
        self.assertEqual((a.limit, a.used, a.remaining), (5, 4, 1))
        credits.set_remaining(self.user, "all", 0)
        self.assertTrue(all(c["remaining"] == 0 for c in credits.credit_summary(self.user).values()))
        credits.reset(self.user, "all")
        self.assertTrue(all(c["remaining"] >= 3 for c in credits.credit_summary(self.user).values()))
