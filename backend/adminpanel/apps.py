from django.apps import AppConfig


class AdminPanelConfig(AppConfig):
    """App config for the in-app admin panel (audit log model and /api/admin routes)."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'adminpanel'
    verbose_name = 'Admin panel'
