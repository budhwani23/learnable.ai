from django.contrib import admin

from .models import LearningResource, QuizAttempt, ResourceAccess


@admin.register(LearningResource)
class LearningResourceAdmin(admin.ModelAdmin):
    list_display = ("title", "type", "owner", "share_enabled", "created_at")
    list_filter = ("type", "share_enabled")
    search_fields = ("title", "owner__username")


@admin.register(QuizAttempt)
class QuizAttemptAdmin(admin.ModelAdmin):
    list_display = ("resource", "user", "score", "max_score", "grade_synced", "created_at")
    list_filter = ("grade_synced",)


admin.site.register(ResourceAccess)
