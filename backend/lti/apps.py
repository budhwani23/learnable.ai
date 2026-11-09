from django.apps import AppConfig


class LtiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "lti"
    verbose_name = "LMS integration (LTI 1.3)"
