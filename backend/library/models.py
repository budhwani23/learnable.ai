"""
Saved learning resources.

Generated summaries / mindmaps / quizzes / flashcards / explainer videos get a
stable id here so they can be linked from an LMS course (LTI) or shared to
Google Classroom, and quiz attempts can be graded and sent to a gradebook.
"""
import uuid

from django.contrib.auth.models import User
from django.db import models


class LearningResource(models.Model):
    TYPE_SUMMARY = "summary"
    TYPE_MINDMAP = "mindmap"
    TYPE_QUIZ = "quiz"
    TYPE_FLASHCARDS = "flashcards"
    TYPE_VIDEO = "video"
    TYPES = [
        (TYPE_SUMMARY, "Summary"),
        (TYPE_MINDMAP, "Mindmap"),
        (TYPE_QUIZ, "Quiz"),
        (TYPE_FLASHCARDS, "Flashcards"),
        (TYPE_VIDEO, "Explainer video"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="learning_resources")
    type = models.CharField(max_length=20, choices=TYPES)
    title = models.CharField(max_length=200)
    # Exact API output shape for the type (SummarizeTextOutput, MindmapOutput, MCQQuizOutput, ...)
    payload = models.JSONField(default=dict, blank=True)
    explainer_job_id = models.CharField(max_length=32, blank=True, default="")
    # When on, any signed-in user with the link can open it (used for Google Classroom sharing).
    share_enabled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.get_type_display()}: {self.title}"

    @property
    def max_score(self) -> int:
        if self.type != self.TYPE_QUIZ:
            return 0
        return len((self.payload or {}).get("quiz") or [])


class ResourceAccess(models.Model):
    """Grants a non-owner (a student) access to a resource."""
    VIA_LTI = "lti"
    VIA_LINK = "link"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="resource_access")
    resource = models.ForeignKey(LearningResource, on_delete=models.CASCADE, related_name="access")
    granted_via = models.CharField(max_length=10, choices=[(VIA_LTI, "LMS launch"), (VIA_LINK, "Shared link")])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "resource")


class QuizAttempt(models.Model):
    """A graded quiz attempt; optionally pushed to an LMS gradebook."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="quiz_attempts")
    resource = models.ForeignKey(LearningResource, on_delete=models.CASCADE, related_name="attempts")
    answers = models.JSONField(default=list)
    score = models.PositiveIntegerField()
    max_score = models.PositiveIntegerField()
    # Set when the attempt was made from an LMS launch (string id of lti.LtiLaunch)
    lti_launch_id = models.CharField(max_length=64, blank=True, default="")
    grade_synced = models.BooleanField(default=False)
    grade_sync_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
