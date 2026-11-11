from django.apps import AppConfig


class UsersConfig(AppConfig):
    """
    App configuration for the Users app.
    Ensures signals are registered when the app is ready.
    """
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'

    def ready(self):
        # Import signals to auto-create profiles on user creation
        from . import signals  # noqa: F401 