"""
LTI 1.3 state. Platform registrations themselves (issuer, client id, keys) live
in PyLTI1p3's own `lti1p3_tool_config` app and are managed in Django admin.
"""
import hashlib
import secrets
import uuid
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone

from library.models import LearningResource

CODE_TTL = timedelta(seconds=120)


class LtiUserLink(models.Model):
    """Maps an LMS user (issuer + sub) to a learnable.ai account."""
    issuer = models.CharField(max_length=255)
    sub = models.CharField(max_length=255)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="lti_links")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("issuer", "sub")


class LtiResourceLink(models.Model):
    """An activity placed in an LMS course, pointing at a learnable.ai resource."""
    issuer = models.CharField(max_length=255)
    resource_link_id = models.CharField(max_length=255)
    resource = models.ForeignKey(LearningResource, on_delete=models.CASCADE, related_name="lti_links")
    context_title = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("issuer", "resource_link_id")


class LtiLaunch(models.Model):
    """
    A validated launch. Stores the launch JWT body so grades can be sent later
    (after the cached launch has expired), plus a single-use code the frontend
    exchanges for normal app tokens — so no tokens ever travel in a URL.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="lti_launches")
    issuer = models.CharField(max_length=255)
    launch_data = models.JSONField()
    is_instructor = models.BooleanField(default=False)
    is_deep_link = models.BooleanField(default=False)
    resource = models.ForeignKey(LearningResource, null=True, blank=True, on_delete=models.SET_NULL)
    code_hash = models.CharField(max_length=64, unique=True)
    code_expires_at = models.DateTimeField()
    code_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    @staticmethod
    def hash_code(code: str) -> str:
        return hashlib.sha256(code.encode()).hexdigest()

    @classmethod
    def new_code(cls) -> str:
        return secrets.token_urlsafe(32)

    @property
    def code_valid(self) -> bool:
        return not self.code_used and timezone.now() < self.code_expires_at

    @property
    def context_title(self) -> str:
        ctx = self.launch_data.get("https://purl.imsglobal.org/spec/lti/claim/context") or {}
        return ctx.get("title") or ctx.get("label") or ""
