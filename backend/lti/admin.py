from django.contrib import admin

from .models import LtiLaunch, LtiResourceLink, LtiUserLink


@admin.register(LtiUserLink)
class LtiUserLinkAdmin(admin.ModelAdmin):
    list_display = ("user", "issuer", "sub", "created_at")
    search_fields = ("user__username", "issuer", "sub")


@admin.register(LtiResourceLink)
class LtiResourceLinkAdmin(admin.ModelAdmin):
    list_display = ("resource", "context_title", "issuer", "resource_link_id", "created_at")


@admin.register(LtiLaunch)
class LtiLaunchAdmin(admin.ModelAdmin):
    list_display = ("user", "issuer", "is_instructor", "is_deep_link", "resource", "created_at")
    exclude = ("code_hash",)
    readonly_fields = ("launch_data",)
