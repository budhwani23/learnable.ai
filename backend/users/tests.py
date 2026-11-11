import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

from users.auth import create_tokens
from users.services import get_role, set_role


def post(client, url, body, token=None):
    """POST a JSON body to url, with an optional Bearer token."""
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return client.post(url, data=json.dumps(body), content_type="application/json", **headers)


class RoleAuthTests(TestCase):
    """Registration roles and role-checked login through the student/teacher portals."""
    def setUp(self):
        """Create a fresh test client."""
        self.client = Client()

    def register(self, username, role=None):
        """Register a user with an optional role and return the response."""
        body = {"username": username, "email": f"{username}@example.com", "password": "s3cret-pass"}
        if role:
            body["role"] = role
        return post(self.client, "/api/users/auth/register", body)

    def me(self, access):
        """Return the /auth/me payload for the given access token."""
        return self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION=f"Bearer {access}").json()

    def test_register_defaults_to_student(self):
        """Registering without a role creates a student."""
        r = self.register("stu1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.me(r.json()["access"])["role"], "student")

    def test_register_teacher(self):
        """Registering with role=teacher creates a teacher."""
        r = self.register("teach1", "teacher")
        self.assertEqual(self.me(r.json()["access"])["role"], "teacher")

    def test_register_rejects_unknown_role(self):
        """Registering with an unknown role (e.g. admin) is rejected with 422."""
        self.assertEqual(self.register("bad1", "admin").status_code, 422)

    def test_login_through_matching_portal(self):
        """A teacher can log in through the teacher portal."""
        self.register("teach2", "teacher")
        r = post(self.client, "/api/users/auth/login",
                 {"username": "teach2", "password": "s3cret-pass", "role": "teacher"})
        self.assertEqual(r.status_code, 200)

    def test_login_through_wrong_portal_is_refused(self):
        """Logging in through the wrong role's portal returns 403 naming the real account type."""
        self.register("stu2", "student")
        r = post(self.client, "/api/users/auth/login",
                 {"username": "stu2", "password": "s3cret-pass", "role": "teacher"})
        self.assertEqual(r.status_code, 403)
        self.assertIn("student account", r.json()["detail"])

    def test_login_without_role_still_works(self):
        """Login without a role field still succeeds."""
        self.register("stu3")
        r = post(self.client, "/api/users/auth/login", {"username": "stu3", "password": "s3cret-pass"})
        self.assertEqual(r.status_code, 200)

    def test_wrong_password_is_401_not_403(self):
        """A wrong password returns 401, not the portal-mismatch 403."""
        self.register("stu4")
        r = post(self.client, "/api/users/auth/login",
                 {"username": "stu4", "password": "nope-nope", "role": "teacher"})
        self.assertEqual(r.status_code, 401)


class CreditsAndRefreshTests(TestCase):
    """Removal of self-service credit endpoints and token refresh handling."""
    def setUp(self):
        """Create a client, a plain user and a staff user."""
        self.client = Client()
        self.user = User.objects.create_user("plain", password="x" * 10)
        self.staff = User.objects.create_user("admin1", password="x" * 10, is_staff=True)

    def token(self, user):
        """Return the (access, refresh) token pair for user."""
        return create_tokens(user.id, user.username)

    def test_old_self_service_credit_endpoints_are_gone(self):
        """Old /credits/add and /credits/deduct endpoints 404 and /me shows 3 credits per resource type."""
        # Replaced by per-resource credits managed in the admin panel (/api/admin/users/{id}/credits).
        access = self.token(self.staff)[0]
        for path in ("/api/users/credits/add", "/api/users/credits/deduct"):
            self.assertEqual(post(self.client, path, {"amount": 50}, access).status_code, 404, path)
        me = self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION=f"Bearer {self.token(self.user)[0]}").json()
        self.assertEqual(set(me["credits"]), {"summary", "mindmap", "quiz", "flashcards", "video", "slides"})
        self.assertTrue(all(c == {"limit": 3, "used": 0, "remaining": 3} for c in me["credits"].values()))

    def test_refresh_accepts_json_body_and_query(self):
        """Refresh accepts the refresh token in a JSON body or a query parameter."""
        refresh = self.token(self.user)[1]
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {"refresh": refresh}).status_code, 200)
        r = self.client.post(f"/api/users/auth/refresh?refresh={refresh}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.json())

    def test_refresh_rejects_missing_access_and_garbage_tokens(self):
        """Refresh returns 401 for a missing token, an access token or a garbage token."""
        access = self.token(self.user)[0]
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {}).status_code, 401)
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {"refresh": access}).status_code, 401)
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {"refresh": "garbage"}).status_code, 401)


class TeacherOnlySharingTests(TestCase):
    """Only teachers can save to the library; students can take shared quizzes."""
    def setUp(self):
        """Create a teacher, a student and a one-question quiz payload."""
        self.client = Client()
        self.teacher = User.objects.create_user("t", password="x" * 10)
        set_role(self.teacher, "teacher")
        self.student = User.objects.create_user("s", password="x" * 10)
        self.quiz = {"type": "quiz", "title": "Q", "payload": {"quiz": [
            {"question": "1+1?", "options": ["1", "2"], "correct_answer": "B", "explanation": ""}]}}

    def token(self, user):
        """Return an access token for user."""
        return create_tokens(user.id, user.username)[0]

    def test_new_users_are_students(self):
        """New users get the student role by default."""
        self.assertEqual(get_role(self.student), "student")

    def test_student_cannot_save_to_library(self):
        """Students get 403 when saving a resource to the library."""
        r = post(self.client, "/api/library/resources", self.quiz, self.token(self.student))
        self.assertEqual(r.status_code, 403)

    def test_teacher_can_save_and_student_can_take_quiz(self):
        """A teacher saves and shares a quiz, and a student attempts it and is scored."""
        r = post(self.client, "/api/library/resources", self.quiz, self.token(self.teacher))
        self.assertEqual(r.status_code, 200, r.content)
        rid = r.json()["resource"]["id"]
        r = self.client.patch(f"/api/library/resources/{rid}/sharing", data=json.dumps({"share_enabled": True}),
                              content_type="application/json",
                              HTTP_AUTHORIZATION=f"Bearer {self.token(self.teacher)}")
        self.assertEqual(r.status_code, 200)
        # Answers are the chosen option texts.
        r = post(self.client, f"/api/library/resources/{rid}/attempts", {"answers": ["2"]}, self.token(self.student))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["score"], 1)
