"""Admin panel API: server-side permission checks, moderation, credits and audit log."""
import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

from adminpanel.models import AuditLog
from users import credits
from users.auth import create_tokens
from users.models import UserProfile
from users.services import set_status


def hdr(user):
    return {"HTTP_AUTHORIZATION": f"Bearer {create_tokens(user.id, user.username)[0]}"}


class AdminPanelTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.root = User.objects.create_superuser("root", "root@example.com", "x" * 10)
        self.staff = User.objects.create_user("mod", password="x" * 10, is_staff=True)
        self.user = User.objects.create_user("alice", "alice@example.com", "x" * 10)
        self.waiting = [User.objects.create_user(f"wait{i}", password="x" * 10) for i in range(3)]
        for u in self.waiting:
            set_status(u, UserProfile.STATUS_PENDING)

    def post(self, url, body, as_user):
        return self.client.post(url, data=json.dumps(body), content_type="application/json", **hdr(as_user))

    def test_every_admin_endpoint_rejects_non_admins(self):
        uid = self.user.id
        gets = ["/api/admin/stats", "/api/admin/users", f"/api/admin/users/{uid}", "/api/admin/waitlist",
                "/api/admin/usage", "/api/admin/audit"]
        posts = [(f"/api/admin/users/{uid}/status", {"status": "banned"}),
                 (f"/api/admin/users/{uid}/active", {"active": False}),
                 (f"/api/admin/users/{uid}/role", {"role": "admin"}),
                 (f"/api/admin/users/{uid}/credits", {"action": "grant", "amount": 100}),
                 ("/api/admin/waitlist/bulk", {"user_ids": [u.id for u in self.waiting], "action": "approve"})]
        for url in gets:
            self.assertEqual(self.client.get(url).status_code, 401, url)
            r = self.client.get(url, **hdr(self.user))
            self.assertEqual((r.status_code, r.json().get("code")), (403, "admin_only"), url)
        for url, body in posts:
            self.assertEqual(self.post(url, body, self.user).status_code, 403, url)
        # Nothing changed.
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)
        self.assertFalse(self.user.is_staff)
        self.assertEqual(credits.credit_summary(self.user)["quiz"]["remaining"], 3)
        self.assertEqual(UserProfile.objects.filter(status="pending").count(), 3)
        self.assertFalse(AuditLog.objects.exists())

    def test_waitlist_approve_reject_and_bulk(self):
        r = self.client.get("/api/admin/waitlist", **hdr(self.staff))
        self.assertEqual(r.json()["total"], 3)
        a, b, c = self.waiting
        r = self.post(f"/api/admin/users/{a.id}/status", {"status": "approved"}, self.staff)
        self.assertEqual(r.json()["user"]["status"], "approved")
        r = self.post("/api/admin/waitlist/bulk", {"user_ids": [a.id, b.id, c.id], "action": "reject",
                                                   "reason": "not yet"}, self.staff)
        self.assertEqual(r.json(), {"updated": 2, "skipped": 1})  # a was no longer pending
        self.assertEqual(UserProfile.objects.get(user=b).status, "rejected")
        self.assertEqual(UserProfile.objects.get(user=a).status, "approved")
        entries = {(e.action, e.target_username, e.actor_username) for e in AuditLog.objects.all()}
        self.assertEqual(entries, {("user.status.approved", a.username, "mod"),
                                   ("user.status.rejected", b.username, "mod"),
                                   ("user.status.rejected", c.username, "mod")})
        self.assertEqual(AuditLog.objects.get(target=b).details["via"], "waitlist")

    def test_user_management_and_credit_top_up(self):
        r = self.client.get("/api/admin/users?q=alice", **hdr(self.staff))
        self.assertEqual([u["username"] for u in r.json()["users"]], ["alice"])
        r = self.client.get("/api/admin/users?status=pending", **hdr(self.staff))
        self.assertEqual(r.json()["total"], 3)
        r = self.client.get("/api/admin/users?role=admin", **hdr(self.staff))
        self.assertEqual({u["username"] for u in r.json()["users"]}, {"root", "mod"})

        for _ in range(3):
            credits.consume(self.user, "summary")
        r = self.post(f"/api/admin/users/{self.user.id}/credits",
                      {"action": "grant", "resource_type": "summary", "amount": 2}, self.staff)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["credits"]["summary"]["remaining"], 2)
        r = self.post(f"/api/admin/users/{self.user.id}/credits",
                      {"action": "grant", "resource_type": "nope", "amount": 2}, self.staff)
        self.assertEqual(r.status_code, 400)

        self.post(f"/api/admin/users/{self.user.id}/role", {"role": "teacher"}, self.staff)
        self.assertEqual(UserProfile.objects.get(user=self.user).role, "teacher")
        self.post(f"/api/admin/users/{self.user.id}/active", {"active": False}, self.staff)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)

        detail = self.client.get(f"/api/admin/users/{self.user.id}", **hdr(self.staff)).json()
        self.assertEqual(detail["usage"]["summary"]["charged"], 3)
        self.assertEqual(detail["is_active"], False)
        self.assertEqual({a["action"] for a in detail["audit"]}, {"credits.grant", "user.role", "user.deactivate"})

        stats = self.client.get("/api/admin/stats?days=7", **hdr(self.staff)).json()
        self.assertEqual(len(stats["series"]), 7)
        self.assertEqual(stats["totals"]["pending"], 3)
        self.assertEqual(stats["generations_by_type"]["summary"], 3)
        usage = self.client.get("/api/admin/usage", **hdr(self.staff)).json()
        self.assertEqual(usage["by_type"]["summary"]["charged"], 3)
        audit = self.client.get("/api/admin/audit", **hdr(self.staff)).json()
        self.assertEqual(audit["total"], 3)

    def test_audit_ip_ignores_forged_forwarded_for(self):
        from django.test import override_settings
        url, body = f"/api/admin/users/{self.user.id}/role", {"role": "teacher"}
        self.client.post(url, data=json.dumps(body), content_type="application/json",
                         HTTP_X_FORWARDED_FOR="6.6.6.6", REMOTE_ADDR="10.0.0.5", **hdr(self.staff))
        self.assertEqual(AuditLog.objects.latest("id").ip_address, "10.0.0.5")
        with override_settings(TRUSTED_PROXY_COUNT=1):
            self.client.post(url, data=json.dumps({"role": "student"}), content_type="application/json",
                             HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.9", REMOTE_ADDR="10.0.0.5", **hdr(self.staff))
        self.assertEqual(AuditLog.objects.latest("id").ip_address, "203.0.113.9")

    def test_admin_safety_rules(self):
        # No self lock-out.
        r = self.post(f"/api/admin/users/{self.staff.id}/active", {"active": False}, self.staff)
        self.assertEqual(r.status_code, 400)
        # Plain staff can't create admins or touch other admins/superusers.
        r = self.post(f"/api/admin/users/{self.user.id}/role", {"role": "admin"}, self.staff)
        self.assertEqual(r.status_code, 403)
        r = self.post(f"/api/admin/users/{self.root.id}/active", {"active": False}, self.staff)
        self.assertEqual(r.status_code, 403)
        # Superusers can.
        r = self.post(f"/api/admin/users/{self.user.id}/role", {"role": "admin"}, self.root)
        self.assertEqual((r.status_code, r.json()["user"]["role"]), (200, "admin"))
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_staff)
        # Deactivated admins lose admin API access immediately.
        self.staff.is_active = False
        self.staff.save()
        self.assertEqual(self.client.get("/api/admin/stats", **hdr(self.staff)).status_code, 403)
