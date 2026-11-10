from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Read-only Django admin view of the admin-panel audit log."""
    list_display = ('created_at', 'actor_username', 'action', 'target_username', 'ip_address')
    list_filter = ('action',)
    search_fields = ('actor_username', 'target_username')
    readonly_fields = [f.name for f in AuditLog._meta.fields]

    def has_add_permission(self, request):
        """Disallow creating audit entries by hand; they are written only by the admin panel API."""
        return False

    def has_change_permission(self, request, obj=None):
        """Disallow editing audit entries so the trail can't be altered."""
        return False

    def has_delete_permission(self, request, obj=None):
        """Disallow deleting audit entries; the log is append-only."""
        return False  # append-only: nobody can erase the trail of their own actions
