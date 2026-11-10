from django.contrib.auth.models import User
from django.db import models


class AuditLog(models.Model):
    """Append-only record of every change an admin makes through the admin panel."""
    actor = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='admin_actions')
    # Kept as text too, so the log still reads correctly after a user is deleted.
    actor_username = models.CharField(max_length=150)
    action = models.CharField(max_length=64, db_index=True)
    target = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='admin_actions_received')
    target_username = models.CharField(max_length=150, blank=True, default='')
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        """Newest entries first."""
        ordering = ['-created_at', '-id']

    def __str__(self) -> str:
        """One-line summary: timestamp, actor, action and target."""
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor_username} {self.action} {self.target_username}"
