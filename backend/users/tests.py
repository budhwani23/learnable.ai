import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

from users.auth import create_tokens
from users.services import get_role, set_role


def post(client, url, body, token=None):
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return client.post(url, data=json.dumps(body), content_type="application/json", **headers)


class RoleAuthTests(TestCase):
    def setUp(self):
        self.client = Client()

    def register(self, username, role=None):
        body = {"username": username, "email": f"{username}@example.com", "password": "s3cret-pass"}
        if role:
            body["role"] = role
        return post(self.client, "/api/users/auth/register", body)

    def me(self, access):
        return self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION=f"Bearer {access}").json()

    def test_register_defaults_to_student(self):
        r = self.register("stu1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.me(r.json()["access"])["role"], "student")

    def test_register_teacher(self):
        r = self.register("teach1", "teacher")
        self.assertEqual(self.me(r.json()["access"])["role"], "teacher")

    def test_register_rejects_unknown_role(self):
        self.assertEqual(self.register("bad1", "admin").status_code, 422)

    def test_login_through_matching_portal(self):
        self.register("teach2", "teacher")
        r = post(self.client, "/api/users/auth/login",
                 {"username": "teach2", "password": "s3cret-pass", "role": "teacher"})
        self.assertEqual(r.status_code, 200)

    def test_login_through_wrong_portal_is_refused(self):
        self.register("stu2", "student")
        r = post(self.client, "/api/users/auth/login",
                 {"username": "stu2", "password": "s3cret-pass", "role": "teacher"})
        self.assertEqual(r.status_code, 403)
        self.assertIn("student account", r.json()["detail"])

    def test_login_without_role_still_works(self):
        self.register("stu3")
        r = post(self.client, "/api/users/auth/login", {"username": "stu3", "password": "s3cret-pass"})
        self.assertEqual(r.status_code, 200)

    def test_wrong_password_is_401_not_403(self):
        self.register("stu4")
        r = post(self.client, "/api/users/auth/login",
                 {"username": "stu4", "password": "nope-nope", "role": "teacher"})
        self.assertEqual(r.status_code, 401)


class CreditsAndRefreshTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user("plain", password="x" * 10)
        self.staff = User.objects.create_user("admin1", password="x" * 10, is_staff=True)

    def token(self, user):
        return create_tokens(user.id, user.username)

    def test_ordinary_user_cannot_add_or_deduct_credits(self):
        access = self.token(self.user)[0]
        for path in ("/api/users/credits/add", "/api/users/credits/deduct"):
            r = post(self.client, path, {"amount": 1000}, access)
            self.assertEqual(r.status_code, 403, path)
        me = self.client.get("/api/users/auth/me", HTTP_AUTHORIZATION=f"Bearer {access}").json()
        self.assertEqual(me["credits"], 100)

    def test_staff_can_add_credits(self):
        r = post(self.client, "/api/users/credits/add", {"amount": 50}, self.token(self.staff)[0])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["credits"], 150)

    def test_refresh_accepts_json_body_and_query(self):
        refresh = self.token(self.user)[1]
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {"refresh": refresh}).status_code, 200)
        r = self.client.post(f"/api/users/auth/refresh?refresh={refresh}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.json())

    def test_refresh_rejects_missing_access_and_garbage_tokens(self):
        access = self.token(self.user)[0]
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {}).status_code, 401)
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {"refresh": access}).status_code, 401)
        self.assertEqual(post(self.client, "/api/users/auth/refresh", {"refresh": "garbage"}).status_code, 401)


class TeacherOnlySharingTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.teacher = User.objects.create_user("t", password="x" * 10)
        set_role(self.teacher, "teacher")
        self.student = User.objects.create_user("s", password="x" * 10)
        self.quiz = {"type": "quiz", "title": "Q", "payload": {"quiz": [
            {"question": "1+1?", "options": ["1", "2"], "correct_answer": "B", "explanation": ""}]}}

    def token(self, user):
        return create_tokens(user.id, user.username)[0]

    def test_new_users_are_students(self):
        self.assertEqual(get_role(self.student), "student")

    def test_student_cannot_save_to_library(self):
        r = post(self.client, "/api/library/resources", self.quiz, self.token(self.student))
        self.assertEqual(r.status_code, 403)

    def test_teacher_can_save_and_student_can_take_quiz(self):
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
