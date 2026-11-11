"""Admins (staff users) have unlimited credits."""
from django.contrib.auth.models import User
from django.test import TestCase

from users import credits
from users.models import CreditAllowance, UsageEvent


class AdminUnlimitedCreditsTests(TestCase):
    """Staff are never charged or blocked; regular users keep their 3-per-type limit."""

    def setUp(self):
        """One admin and one regular user."""
        self.admin = User.objects.create_user("boss", password="x" * 12, is_staff=True)
        self.student = User.objects.create_user("kid", password="x" * 12)

    def test_admin_is_never_blocked(self):
        """An admin can generate far past the default limit; each generation is still logged."""
        for _ in range(10):
            credits.consume(self.admin, "summary")
        self.assertEqual(UsageEvent.objects.filter(user=self.admin, resource_type="summary").count(), 10)
        # No allowance is consumed (the row isn't even needed).
        a = CreditAllowance.objects.filter(user=self.admin, resource_type="summary").first()
        self.assertTrue(a is None or a.used == 0)

    def test_regular_user_still_limited(self):
        """A regular user is still stopped after their limit."""
        limit = credits.default_credit_limit()
        for _ in range(limit):
            credits.consume(self.student, "quiz")
        with self.assertRaises(credits.OutOfCredits):
            credits.consume(self.student, "quiz")

    def test_summary_marks_admin_unlimited_and_counts_use(self):
        """credit_summary shows unlimited=True for admins with their real usage count."""
        credits.consume(self.admin, "video")
        credits.consume(self.admin, "video")
        summary = credits.credit_summary(self.admin)
        self.assertTrue(all(v["unlimited"] for v in summary.values()))
        self.assertEqual(summary["video"]["used"], 2)
        self.assertFalse(any(v["unlimited"] for v in credits.credit_summary(self.student).values()))

    def test_refund_for_admin_only_marks_event(self):
        """Refunding an admin's generation marks it refunded without touching any allowance."""
        event = credits.consume(self.admin, "slides")
        self.assertTrue(credits.refund(event.id))
        event.refresh_from_db()
        self.assertTrue(event.refunded)
        self.assertEqual(credits.credit_summary(self.admin)["slides"]["used"], 0)
        a = CreditAllowance.objects.filter(user=self.admin, resource_type="slides").first()
        self.assertTrue(a is None or a.used == 0)
