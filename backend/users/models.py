from django.db import models
from django.contrib.auth.models import User


class UserProfile(models.Model):
    """
    Per-user profile for additional fields like credit balance and
    cumulative Gemini token usage. Linked 1:1 with Django's built-in User.
    """
    ROLE_TEACHER = 'teacher'
    ROLE_STUDENT = 'student'
    ROLES = [(ROLE_TEACHER, 'Teacher'), (ROLE_STUDENT, 'Student')]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')

    # Teachers create and share resources to classes; students study and take shared quizzes.
    role = models.CharField(max_length=16, choices=ROLES, default=ROLE_STUDENT, db_index=True)

    # Balance of credits available to the user (app-defined unit)
    credits = models.PositiveIntegerField(default=100)

    # Optional cumulative usage counters for reporting/analytics
    gemini_input_tokens = models.PositiveBigIntegerField(default=0)
    gemini_output_tokens = models.PositiveBigIntegerField(default=0)

    # Auto-updated timestamp for quick insights on recent changes
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Profile<{self.user.username}> ({self.role}, credits={self.credits})"

    @property
    def is_teacher(self) -> bool:
        return self.role == self.ROLE_TEACHER 