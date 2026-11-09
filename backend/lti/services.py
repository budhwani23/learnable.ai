"""LTI helpers: users from launches, restoring launches, deep links, grade passback."""
import logging
import re
from typing import Optional
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.urls import reverse
from django.utils import timezone
from pylti1p3.contrib.django import DjangoCacheDataStorage, DjangoDbToolConf, DjangoMessageLaunch
from pylti1p3.deep_link_resource import DeepLinkResource
from pylti1p3.grade import Grade
from pylti1p3.lineitem import LineItem

from library.models import LearningResource, QuizAttempt

from .models import CODE_TTL, LtiLaunch, LtiUserLink

logger = logging.getLogger(__name__)

CLAIM_CUSTOM = "https://purl.imsglobal.org/spec/lti/claim/custom"
CLAIM_RESOURCE_LINK = "https://purl.imsglobal.org/spec/lti/claim/resource_link"
CLAIM_AGS = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint"


def tool_conf() -> DjangoDbToolConf:
    return DjangoDbToolConf()


def launch_storage() -> DjangoCacheDataStorage:
    return DjangoCacheDataStorage(cache_name="default")


def frontend_url(path: str, **params) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}{path}" + (f"?{urlencode(params)}" if params else "")


def launch_url(request) -> str:
    return request.build_absolute_uri(reverse("lti-launch"))


def user_for_launch(issuer: str, data: dict) -> User:
    """Find or create the learnable.ai account for an LMS user."""
    sub = str(data["sub"])
    link = LtiUserLink.objects.select_related("user").filter(issuer=issuer, sub=sub).first()
    if link:
        return link.user
    with transaction.atomic():
        base = re.sub(r"[^\w.@+-]", "", (data.get("email") or "").split("@")[0] or "lti")[:100] or "lti"
        username, n = f"{base}-lti", 1
        while User.objects.filter(username=username).exists():
            n += 1
            username = f"{base}-lti{n}"
        user = User(username=username, email=data.get("email") or "",
                    first_name=(data.get("given_name") or "")[:150],
                    last_name=(data.get("family_name") or "")[:150])
        user.set_unusable_password()  # LMS users sign in through their LMS only
        user.save()
        LtiUserLink.objects.create(issuer=issuer, sub=sub, user=user)
    return user


def create_launch(user: User, issuer: str, data: dict, *, is_instructor: bool, is_deep_link: bool,
                  resource: Optional[LearningResource]) -> tuple:
    code = LtiLaunch.new_code()
    launch = LtiLaunch.objects.create(
        user=user, issuer=issuer, launch_data=data, is_instructor=is_instructor,
        is_deep_link=is_deep_link, resource=resource, code_hash=LtiLaunch.hash_code(code),
        code_expires_at=timezone.now() + CODE_TTL,
    )
    return launch, code


def restore_launch(request, launch: LtiLaunch) -> DjangoMessageLaunch:
    """Rebuild a message launch from the stored JWT body (cache may have expired)."""
    ml = DjangoMessageLaunch(request, tool_conf(), launch_data_storage=launch_storage())
    return (ml.set_launch_id(f"lti1p3-launch-{launch.id}")
              .set_auto_validation(enable=False)
              .set_jwt({"body": launch.launch_data})
              .set_restored()
              .validate_registration())


def deep_link_response(request, launch: LtiLaunch, resource: LearningResource) -> dict:
    """Signed deep-linking response the frontend auto-posts back to the LMS."""
    ml = restore_launch(request, launch)
    item = (DeepLinkResource()
            .set_url(launch_url(request))
            .set_title(resource.title)
            .set_custom_params({"resource_id": str(resource.id)}))
    if resource.type == LearningResource.TYPE_QUIZ and resource.max_score:
        item.set_lineitem(LineItem()
                          .set_label(resource.title)
                          .set_score_maximum(resource.max_score)
                          .set_resource_id(str(resource.id))
                          .set_tag("learnable-quiz"))
    deep_link = ml.get_deep_link()
    jwt_val = deep_link.get_response_jwt([item])
    settings_claim = launch.launch_data.get(
        "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings") or {}
    return {"return_url": settings_claim.get("deep_link_return_url"), "jwt": jwt_val}


def submit_grade(request, attempt: QuizAttempt) -> None:
    """Send a quiz attempt to the LMS gradebook (Assignment & Grade Services)."""
    launch = LtiLaunch.objects.filter(id=attempt.lti_launch_id).first() if _is_uuid(attempt.lti_launch_id) else None
    if not launch or launch.user_id != attempt.user_id or launch.resource_id != attempt.resource_id:
        _sync_failed(attempt, "Launch not found for this attempt.")
        return
    try:
        ml = restore_launch(request, launch)
        if not ml.has_ags():
            _sync_failed(attempt, "This course didn't enable grade passback for the activity.")
            return
        ags = ml.get_ags()
        if not ags.can_put_grade():
            _sync_failed(attempt, "The LMS did not grant permission to send scores.")
            return
        grade = (Grade()
                 .set_score_given(attempt.score)
                 .set_score_maximum(attempt.max_score)
                 .set_timestamp(timezone.now().isoformat())
                 .set_activity_progress("Completed")
                 .set_grading_progress("FullyGraded")
                 .set_user_id(str(launch.launch_data["sub"])))
        ags_claim = launch.launch_data.get(CLAIM_AGS) or {}
        if ags_claim.get("lineitem"):
            ags.put_grade(grade)  # line item created by the deep link
        else:
            line = (LineItem().set_tag("learnable-quiz").set_resource_id(str(attempt.resource_id))
                    .set_label(attempt.resource.title).set_score_maximum(attempt.max_score))
            ags.put_grade(grade, ags.find_or_create_lineitem(line, find_by="resource_id"))
        attempt.grade_synced = True
        attempt.grade_sync_error = ""
        attempt.save(update_fields=["grade_synced", "grade_sync_error"])
    except Exception as e:
        logger.exception("Grade passback failed for attempt %s", attempt.id)
        _sync_failed(attempt, f"Could not send the score to your LMS: {e}")


def _sync_failed(attempt: QuizAttempt, msg: str) -> None:
    attempt.grade_synced = False
    attempt.grade_sync_error = msg
    attempt.save(update_fields=["grade_synced", "grade_sync_error"])


def _is_uuid(v: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F-]{36}", v or ""))
