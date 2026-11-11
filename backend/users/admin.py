from django.contrib import admin

from .models import CreditAllowance, UsageEvent, UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    """Fallback Django admin view; day-to-day user management lives in the in-app admin panel."""
    list_display = ('user', 'role', 'status', 'gemini_input_tokens', 'gemini_output_tokens', 'updated_at')
    list_filter = ('role', 'status')
    search_fields = ('user__username', 'user__email')


@admin.register(CreditAllowance)
class CreditAllowanceAdmin(admin.ModelAdmin):
    """Django admin view of per-user, per-resource-type credit allowances."""
    list_display = ('user', 'resource_type', 'used', 'limit', 'updated_at')
    list_filter = ('resource_type',)
    search_fields = ('user__username', 'user__email')


@admin.register(UsageEvent)
class UsageEventAdmin(admin.ModelAdmin):
    """Django admin view of charged (and refunded) generations."""
    list_display = ('created_at', 'user', 'resource_type', 'refunded', 'ref')
    list_filter = ('resource_type', 'refunded')
    search_fields = ('user__username',)
