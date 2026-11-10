from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


class UserProfile(models.Model):
    """
    Per-user profile: role, waitlist/account status and cumulative Gemini token usage.
    Linked 1:1 with Django's built-in User. Generation allowances live in CreditAllowance.
    """
    ROLE_TEACHER = 'teacher'
    ROLE_STUDENT = 'student'
    ROLES = [(ROLE_TEACHER, 'Teacher'), (ROLE_STUDENT, 'Student')]

    # Waitlist / moderation status. Self sign-ups start as PENDING (see users.api.register);
    # accounts made any other way (admins, LMS launches, existing users) are APPROVED.
    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_BANNED = 'banned'
    STATUSES = [
        (STATUS_PENDING, 'Pending (waitlist)'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
        (STATUS_BANNED, 'Banned'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')

    # Teachers create and share resources to classes; students study and take shared quizzes.
    role = models.CharField(max_length=16, choices=ROLES, default=ROLE_STUDENT, db_index=True)

    status = models.CharField(max_length=16, choices=STATUSES, default=STATUS_APPROVED, db_index=True)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    # Shown to the user when rejected/banned; set by the admin who made the change.
    status_reason = models.CharField(max_length=300, blank=True, default='')

    # Optional cumulative usage counters for reporting/analytics
    gemini_input_tokens = models.PositiveBigIntegerField(default=0)
    gemini_output_tokens = models.PositiveBigIntegerField(default=0)

    # Auto-updated timestamp for quick insights on recent changes
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        """Readable label with username, role and status."""
        return f"Profile<{self.user.username}> ({self.role}, {self.status})"

    @property
    def is_teacher(self) -> bool:
        """True if the profile's role is teacher."""
        return self.role == self.ROLE_TEACHER

    @property
    def is_approved(self) -> bool:
        """True if the account has been approved (off the waitlist and not rejected/banned)."""
        return self.status == self.STATUS_APPROVED


# Every generator a user can run. Each one has its own allowance ("credits").
RESOURCE_TYPES = [
    ('summary', 'Summary'),
    ('mindmap', 'Mind map'),
    ('quiz', 'Quiz'),
    ('flashcards', 'Flashcards'),
    ('video', 'Explainer video'),
    ('slides', 'Slides'),
]
RESOURCE_TYPE_IDS = [t for t, _ in RESOURCE_TYPES]
RESOURCE_LABELS = dict(RESOURCE_TYPES)


def default_credit_limit() -> int:
    """Credits each user gets per resource type (settings.DEFAULT_CREDITS_PER_RESOURCE, default 3)."""
    return int(getattr(settings, 'DEFAULT_CREDITS_PER_RESOURCE', 3))


class CreditAllowance(models.Model):
    """
    How many generations of one resource type a user may start (`limit`) and how many
    they have used. Remaining credits = limit - used. Rows are created lazily; a missing
    row means the default allowance with nothing used.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='credit_allowances')
    resource_type = models.CharField(max_length=16, choices=RESOURCE_TYPES)
    limit = models.PositiveIntegerField(default=default_credit_limit)
    used = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        """One allowance row per user and resource type."""
        constraints = [
            models.UniqueConstraint(fields=['user', 'resource_type'], name='uniq_allowance_per_type'),
        ]

    @property
    def remaining(self) -> int:
        """Credits left for this resource type (never negative)."""
        return max(0, self.limit - self.used)

    def __str__(self) -> str:
        """Compact label: user id, resource type and used/limit."""
        return f"{self.user_id}:{self.resource_type} {self.used}/{self.limit}"


class UsageEvent(models.Model):
    """One charged generation. Refunded when the generation fails (credit given back)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='usage_events')
    resource_type = models.CharField(max_length=16, choices=RESOURCE_TYPES, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    refunded = models.BooleanField(default=False)
    # Endpoint path or job id, for support/debugging.
    ref = models.CharField(max_length=200, blank=True, default='')

    class Meta:
        """Newest first, indexed by user and resource type."""
        ordering = ['-created_at']
        indexes = [models.Index(fields=['user', 'resource_type'])]

    def __str__(self) -> str:
        """Compact label: user id, resource type and timestamp."""
        return f"{self.user_id}:{self.resource_type} @ {self.created_at:%Y-%m-%d %H:%M}"
