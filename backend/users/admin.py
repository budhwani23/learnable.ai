from django.contrib import admin
from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    """
    Admin interface to review and manage user credits and usage.
    """
    list_display = (
        'user',
        'role',
        'credits',
        'gemini_input_tokens',
        'gemini_output_tokens',
        'updated_at',
    )
    list_filter = ('role',)
    list_editable = ('role',)
    search_fields = ('user__username', 'user__email') 