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
from django.contrib import admin
from django.urls import path
from api.api import api
from lti import views as lti_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', api.urls),
    # LTI 1.3 endpoints called by the LMS (Moodle, Canvas, Blackboard, Brightspace, Schoology)
    path('lti/login/', lti_views.login, name='lti-login'),
    path('lti/launch/', lti_views.launch, name='lti-launch'),
    path('lti/jwks/', lti_views.jwks, name='lti-jwks'),
    path('lti/config/', lti_views.config, name='lti-config'),
]
