"""
LTI 1.3 endpoints the LMS talks to directly (form POSTs / redirects, so plain
Django views rather than Ninja). Everything an LMS frames is exempt from
X-Frame-Options.
"""
import logging

from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import redirect
from django.views.decorators.clickjacking import xframe_options_exempt
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils.html import escape
from pylti1p3.contrib.django import DjangoMessageLaunch, DjangoOIDCLogin
from pylti1p3.exception import LtiException

from library.models import LearningResource, ResourceAccess
from library.services import grant_access
from users.models import UserProfile
from users.services import set_role

from .models import LtiResourceLink
from .services import (CLAIM_CUSTOM, CLAIM_RESOURCE_LINK, create_launch, frontend_url,
                       launch_storage, launch_url, tool_conf, user_for_launch)

logger = logging.getLogger(__name__)


def _error(msg: str, status: int = 400) -> HttpResponse:
    return HttpResponse(
        f"<html><body style='font-family:sans-serif;padding:2rem'><h2>learnable.ai</h2>"
        f"<p>{escape(msg)}</p></body></html>", status=status)


@csrf_exempt
@xframe_options_exempt
@require_http_methods(["GET", "POST"])
def login(request):
    """Step 1 (OIDC third-party login initiation)."""
    target = request.POST.get("target_link_uri") or request.GET.get("target_link_uri")
    if not target:
        return HttpResponseBadRequest("Missing target_link_uri")
    # Only ever redirect back to our own launch endpoint (no open redirect).
    ours = launch_url(request)
    if target.split("?")[0].rstrip("/") != ours.rstrip("/"):
        target = ours
    try:
        oidc = DjangoOIDCLogin(request, tool_conf(), launch_data_storage=launch_storage())
        return oidc.enable_check_cookies().redirect(target)
    except LtiException as e:
        logger.warning("LTI login rejected: %s", e)
        return _error(f"This LMS isn't registered with learnable.ai ({e}).")


@csrf_exempt
@xframe_options_exempt
@require_http_methods(["POST"])
def launch(request):
    """Step 2: validate the signed launch, sign the user in, route to the right screen."""
    try:
        ml = DjangoMessageLaunch(request, tool_conf(), launch_data_storage=launch_storage())
        data = ml.get_launch_data()  # validates signature, nonce, state, deployment
    except LtiException as e:
        logger.warning("LTI launch rejected: %s", e)
        return _error(f"Launch could not be verified: {e}")

    issuer = data["iss"]
    user = user_for_launch(issuer, data)
    is_instructor = ml.check_teacher_access()
    if is_instructor:
        # LMS instructors are teachers here too. Never downgrade: the same person can
        # be a learner in another course.
        set_role(user, UserProfile.ROLE_TEACHER)

    if ml.is_deep_link_launch():
        if not is_instructor:
            return _error("Only instructors can add learnable.ai activities.", 403)
        _, code = create_launch(user, issuer, data, is_instructor=True, is_deep_link=True, resource=None)
        return redirect(frontend_url("/lti", code=code))

    if not ml.is_resource_launch():
        return _error("Unsupported LTI message type.")

    resource = _resource_for_launch(issuer, data)
    if not resource:
        return _error("This activity isn't linked to a learnable.ai resource yet. "
                      "Ask your instructor to re-add it.", 404)
    grant_access(user, resource, ResourceAccess.VIA_LTI)
    _, code = create_launch(user, issuer, data, is_instructor=is_instructor, is_deep_link=False,
                            resource=resource)
    return redirect(frontend_url("/lti", code=code))


def _resource_for_launch(issuer: str, data: dict):
    link_id = (data.get(CLAIM_RESOURCE_LINK) or {}).get("id")
    custom_id = (data.get(CLAIM_CUSTOM) or {}).get("resource_id")
    if link_id:
        link = LtiResourceLink.objects.select_related("resource").filter(
            issuer=issuer, resource_link_id=link_id).first()
        if link:
            return link.resource
    resource = LearningResource.objects.filter(id=custom_id).first() if _uuid(custom_id) else None
    if resource and link_id:
        ctx = data.get("https://purl.imsglobal.org/spec/lti/claim/context") or {}
        LtiResourceLink.objects.get_or_create(
            issuer=issuer, resource_link_id=link_id,
            defaults={"resource": resource, "context_title": (ctx.get("title") or "")[:255]})
    return resource


def _uuid(v) -> bool:
    import uuid
    try:
        uuid.UUID(str(v))
        return True
    except (ValueError, TypeError):
        return False


@xframe_options_exempt
def jwks(request):
    """Public keys the LMS uses to verify our deep-link responses and service tokens."""
    return JsonResponse(tool_conf().get_jwks())


def config(request):
    """The URLs a school admin pastes into their LMS when registering the tool."""
    base = request.build_absolute_uri("/").rstrip("/")
    return JsonResponse({
        "tool_name": "learnable.ai",
        "login_url": f"{base}/lti/login/",
        "launch_url": f"{base}/lti/launch/",
        "redirect_urls": [f"{base}/lti/launch/"],
        "deep_linking_url": f"{base}/lti/launch/",
        "jwks_url": f"{base}/lti/jwks/",
        "services": ["Deep Linking", "Assignment and Grade Services"],
    })
