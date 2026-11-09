# lti/api.py — JSON endpoints the frontend calls during an LMS launch
from uuid import UUID

from django.db import transaction
from django.http import Http404
from ninja import Schema
from ninja.router import Router

from library.models import LearningResource
from users.auth import create_tokens
from users.security import JWTAuth

from .models import LtiLaunch
from .services import deep_link_response

router = Router()


class ExchangeIn(Schema):
    code: str


class DeepLinkIn(Schema):
    launch_id: UUID
    resource_id: UUID


@router.post("/exchange")
def exchange_code(request, data: ExchangeIn):
    """Trade the single-use launch code for normal app tokens + launch context."""
    with transaction.atomic():
        launch = (LtiLaunch.objects.select_for_update().select_related("user")
                  .filter(code_hash=LtiLaunch.hash_code(data.code)).first())
        if not launch or not launch.code_valid:
            return {"error": "This LMS launch link has expired. Please open the activity again."}
        launch.code_used = True
        launch.save(update_fields=["code_used"])
    access, refresh = create_tokens(launch.user.id, launch.user.username)
    return {
        "access": access,
        "refresh": refresh,
        "launch": {
            "id": str(launch.id),
            "mode": "pick" if launch.is_deep_link else "view",
            "resource_id": str(launch.resource_id) if launch.resource_id else None,
            "is_instructor": launch.is_instructor,
            "context_title": launch.context_title,
        },
    }


@router.post("/deep-link", auth=JWTAuth())
def create_deep_link(request, data: DeepLinkIn):
    """Instructor picked a resource: return the signed response to post back to the LMS."""
    launch = LtiLaunch.objects.filter(id=data.launch_id, user=request.auth, is_deep_link=True).first()
    if not launch:
        raise Http404("Launch not found")
    resource = LearningResource.objects.filter(id=data.resource_id, owner=request.auth).first()
    if not resource:
        return {"error": "Pick one of your own saved resources."}
    return {"success": True, **deep_link_response(request, launch, resource)}
