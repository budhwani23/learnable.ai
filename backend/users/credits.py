"""
Per-resource-type generation allowances ("credits").

Every user gets DEFAULT_CREDITS_PER_RESOURCE (3) credits for each resource type
(summary, mindmap, quiz, flashcards, video, slides). A credit is reserved atomically
before a generation starts, so concurrent requests can't overspend, and given back
(refunded) if the generation fails. Admins top up by raising the limit or resetting usage.

Admins (staff users) have unlimited credits: their generations are still recorded as
usage events (so stats stay accurate) but never count against or are blocked by a limit.
"""
import functools
import logging
from typing import Dict, Iterable, Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.http import HttpResponse, JsonResponse

from .models import (CreditAllowance, RESOURCE_LABELS, RESOURCE_TYPE_IDS, UsageEvent,
                     default_credit_limit)

logger = logging.getLogger(__name__)


class OutOfCredits(Exception):
    """Raised when a user has no credits left for a resource type."""
    def __init__(self, resource_type: str, limit: int):
        """Store the resource type and limit and build a user-facing message."""
        self.resource_type = resource_type
        self.limit = limit
        label = RESOURCE_LABELS.get(resource_type, resource_type)
        super().__init__(
            f"You've used all {limit} of your {label} credits. "
            "Ask an administrator for more credits to keep generating."
        )


def _check_type(resource_type: str) -> None:
    """Raise ValueError if `resource_type` is not a known resource type."""
    if resource_type not in RESOURCE_TYPE_IDS:
        raise ValueError(f"Unknown resource type '{resource_type}'")


def is_unlimited(user: User) -> bool:
    """Admins (staff) are never charged or limited."""
    return bool(getattr(user, "is_staff", False))


def credit_summary(user: User) -> Dict[str, Dict[str, int]]:
    """
    {type: {limit, used, remaining, unlimited}} for every resource type (defaults for
    missing rows). For admins `unlimited` is true and `used` counts their generations.
    """
    default = default_credit_limit()
    unlimited = is_unlimited(user)
    out = {t: {"limit": default, "used": 0, "remaining": default, "unlimited": unlimited}
           for t in RESOURCE_TYPE_IDS}
    for a in CreditAllowance.objects.filter(user=user):
        out[a.resource_type] = {"limit": a.limit, "used": a.used, "remaining": a.remaining,
                                "unlimited": unlimited}
    if unlimited:
        used = {}
        for e in UsageEvent.objects.filter(user=user, refunded=False).values_list("resource_type", flat=True):
            used[e] = used.get(e, 0) + 1
        for t in RESOURCE_TYPE_IDS:
            out[t]["used"] = used.get(t, 0)
    return out


def _locked_allowance(user: User, resource_type: str) -> CreditAllowance:
    """The allowance row, locked for update. Must be called inside a transaction."""
    CreditAllowance.objects.get_or_create(user=user, resource_type=resource_type)
    return CreditAllowance.objects.select_for_update().get(user=user, resource_type=resource_type)


@transaction.atomic
def consume(user: User, resource_type: str, ref: str = "") -> UsageEvent:
    """Use one credit. Raises OutOfCredits when none are left. Admins are never charged."""
    _check_type(resource_type)
    if is_unlimited(user):
        # Record the generation for stats, without touching or checking the allowance.
        return UsageEvent.objects.create(user=user, resource_type=resource_type, ref=ref[:200])
    allowance = _locked_allowance(user, resource_type)
    if allowance.used >= allowance.limit:
        raise OutOfCredits(resource_type, allowance.limit)
    allowance.used += 1
    allowance.save(update_fields=["used", "updated_at"])
    return UsageEvent.objects.create(user=user, resource_type=resource_type, ref=ref[:200])


@transaction.atomic
def refund(event_id: Optional[int]) -> bool:
    """Give back the credit for a failed generation. Idempotent."""
    if not event_id:
        return False
    event = UsageEvent.objects.select_for_update().filter(id=event_id, refunded=False).first()
    if not event:
        return False
    if is_unlimited(event.user):
        # Admin generations never used an allowance credit, so only mark the event.
        event.refunded = True
        event.save(update_fields=["refunded"])
        return True
    allowance = _locked_allowance(event.user, event.resource_type)
    allowance.used = max(0, allowance.used - 1)
    allowance.save(update_fields=["used", "updated_at"])
    event.refunded = True
    event.save(update_fields=["refunded"])
    return True


def _types(resource_type: str) -> Iterable[str]:
    """
    Resource types targeted by an admin action: every type for 'all', else just the
    validated one (ValueError if unknown).
    """
    if resource_type == "all":
        return RESOURCE_TYPE_IDS
    _check_type(resource_type)
    return [resource_type]


@transaction.atomic
def grant(user: User, resource_type: str, amount: int) -> None:
    """Top up: add `amount` credits to one type (or 'all')."""
    if amount <= 0:
        raise ValueError("Amount must be positive")
    for t in _types(resource_type):
        a = _locked_allowance(user, t)
        a.limit += amount
        a.save(update_fields=["limit", "updated_at"])


@transaction.atomic
def reset(user: User, resource_type: str) -> None:
    """Reset usage to zero and the limit back to the default for one type (or 'all')."""
    for t in _types(resource_type):
        a = _locked_allowance(user, t)
        a.used = 0
        a.limit = max(a.limit, default_credit_limit())
        a.save(update_fields=["used", "limit", "updated_at"])


@transaction.atomic
def set_remaining(user: User, resource_type: str, remaining: int) -> None:
    """Set the remaining credits for one type (or 'all') to an exact number."""
    if remaining < 0:
        raise ValueError("Remaining credits can't be negative")
    for t in _types(resource_type):
        a = _locked_allowance(user, t)
        a.limit = a.used + remaining
        a.save(update_fields=["limit", "updated_at"])


def out_of_credits_response(user: User, exc: OutOfCredits) -> JsonResponse:
    """402 with a readable message the frontend shows as-is."""
    return JsonResponse({
        "detail": str(exc),
        "error": str(exc),
        "code": "out_of_credits",
        "resource_type": exc.resource_type,
        "credits": credit_summary(user),
    }, status=402)


def _failed(result) -> bool:
    """
    Whether a view result is an error: an HttpResponse or (status, body) tuple with
    status >= 400, or a dict with a truthy 'error' key.
    """
    if isinstance(result, HttpResponse):
        return result.status_code >= 400
    if isinstance(result, tuple) and result and isinstance(result[0], int):
        return result[0] >= 400
    if isinstance(result, dict):
        return bool(result.get("error"))
    return False


def charges_credit(resource_type: str):
    """
    Decorator for synchronous generator endpoints: reserve one credit before running,
    give it back if the endpoint raises or returns an error. Out of credits => 402.
    Place it *under* the @router decorator so it wraps the view itself.
    """
    _check_type(resource_type)

    def decorator(view):
        """Wrap `view` so each call is charged one credit of `resource_type`."""
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            """Consume a credit (402 if none left), run the view, and refund on exception or error result."""
            try:
                event = consume(request.auth, resource_type, ref=request.path)
            except OutOfCredits as exc:
                return out_of_credits_response(request.auth, exc)
            try:
                result = view(request, *args, **kwargs)
            except Exception:
                refund(event.id)
                raise
            if _failed(result):
                refund(event.id)
            return result
        return wrapper
    return decorator


def refund_if_job_failed(run, get_job):
    """
    Wrap a background job runner so the job's credit (job['usage_event_id']) is
    refunded when the job fails or crashes.
    """
    def runner(job_id: str) -> None:
        """Run the job; refund its credit if it raises (then re-raise) or ends with status 'failed'."""
        try:
            run(job_id)
        except Exception:
            _refund_job(get_job, job_id)
            raise
        job = get_job(job_id)
        if job and job.get("status") == "failed":
            _refund_job(get_job, job_id)
    return runner


def _refund_job(get_job, job_id: str) -> None:
    """Refund the credit recorded on the job's `usage_event_id`, logging (not raising) any error."""
    try:
        job = get_job(job_id) or {}
        refund(job.get("usage_event_id"))
    except Exception:  # never let refund bookkeeping mask the job's own error
        logger.exception("Could not refund credit for job %s", job_id)
