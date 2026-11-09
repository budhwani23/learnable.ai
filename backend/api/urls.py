"""
URL configuration for api project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, JsonResponse
from django.urls import path, re_path
from api.api import api
from lti import views as lti_views


def healthz(request):
    """Load balancer health check (no database access, so a DB blip doesn't restart the app)."""
    return JsonResponse({"status": "ok"})


def spa_index(request, path=""):
    """Serve the built React app's index.html for client-side routes (production only)."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Frontend build not found")
    response = FileResponse(open(index, "rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response


urlpatterns = [
    path('healthz', healthz),
    path('admin/', admin.site.urls),
    path('api/', api.urls),
    # LTI 1.3 endpoints called by the LMS (Moodle, Canvas, Blackboard, Brightspace, Schoology)
    path('lti/login/', lti_views.login, name='lti-login'),
    path('lti/launch/', lti_views.launch, name='lti-launch'),
    path('lti/jwks/', lti_views.jwks, name='lti-jwks'),
    path('lti/config/', lti_views.config, name='lti-config'),
    # Everything else is a React route (/input, /login/teacher, /r/<id>, /lti, ...).
    # Static assets are served earlier by WhiteNoise from FRONTEND_DIST.
    re_path(r'^(?!api/|admin/|static/|media/)(?P<path>.*)$', spa_index),
]
