"""
Admin panel API (/api/admin/...). Every route requires a signed-in, active staff user
(users.security.admin_auth), enforced server-side regardless of what the UI shows.

What admins can do:
- stats: users by status/role, signups / active users / generations per day
- users: search + filter, detail (credits, usage, recent generations, audit trail)
- moderation: approve / reject / ban / reset to waitlist, activate / deactivate, change role
- credits: top up, set remaining, or reset per resource type (or all at once)
- waitlist: queue of pending sign-ups with bulk approve / reject
- usage: generations per resource type and the heaviest users
- audit log: every change above, with who did it, when and from where

Safety rules: admins can't change their own status/role/active flag (no self lock-out),
and only superusers can act on other admins or grant/remove admin rights.
"""
from datetime import timedelta
from typing import List, Literal, Optional

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, F, Q
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema

from users import credits
from users.models import CreditAllowance, RESOURCE_TYPE_IDS, UsageEvent, UserProfile
from users.security import admin_auth
from users.services import get_profile, set_role, set_status

from .models import AuditLog

router = Router(auth=admin_auth)

PAGE_SIZE_MAX = 100


# ── helpers ──────────────────────────────────────────────────────────────
def _client_ip(request) -> Optional[str]:
    """
    Caller IP for the audit log. The left-most X-Forwarded-For entry is client-controlled,
    so it is never trusted. With TRUSTED_PROXY_COUNT=N (N proxies in front of Django that
    each append to the header), use the entry the outermost trusted proxy appended.
    """
    hops = int(getattr(settings, "TRUSTED_PROXY_COUNT", 0) or 0)
    if hops > 0:
        chain = [p.strip() for p in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if p.strip()]
        if len(chain) >= hops:
            return chain[-hops]
    return request.META.get("REMOTE_ADDR") or None


def _audit(request, action: str, target: Optional[User] = None, **details) -> None:
    """Record an AuditLog entry for the signed-in admin's action on `target`, with extra `details` and the caller IP."""
    actor = request.auth
    AuditLog.objects.create(
        actor=actor, actor_username=actor.username, action=action,
        target=target, target_username=target.username if target else "",
        details=details, ip_address=_client_ip(request),
    )


def _role_of(user: User) -> str:
    """Effective role for display: 'admin' for staff, else the profile role (student if no profile)."""
    if user.is_staff:
        return "admin"
    profile = getattr(user, "profile", None)
    return profile.role if profile else UserProfile.ROLE_STUDENT


def _status_of(user: User) -> str:
    """Effective waitlist status: staff are always approved; users without a profile count as approved."""
    if user.is_staff:
        return UserProfile.STATUS_APPROVED
    profile = getattr(user, "profile", None)
    return profile.status if profile else UserProfile.STATUS_APPROVED


def _user_row(user: User, credit_map=None) -> dict:
    """
    Serialize a user for the admin panel. Uses `credit_map` (from _credit_maps) when given,
    otherwise queries the user's credit summary.
    """
    profile = getattr(user, "profile", None)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": f"{user.first_name} {user.last_name}".strip(),
        "role": _role_of(user),
        "status": _status_of(user),
        "status_reason": profile.status_reason if profile else "",
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "date_joined": user.date_joined,
        "last_login": user.last_login,
        "generations": getattr(user, "generation_count", None),
        "credits": credit_map.get(user.id) if credit_map is not None else credits.credit_summary(user),
    }


def _credit_maps(users: List[User]) -> dict:
    """
    Build {user_id: {resource_type: {limit, used, remaining, unlimited}}} for `users` in one
    query, filling in the default allowance for missing rows. Admins are marked unlimited.
    """
    default = credits.default_credit_limit()
    unlimited = {u.id for u in users if credits.is_unlimited(u)}
    out = {u.id: {t: {"limit": default, "used": 0, "remaining": default, "unlimited": u.id in unlimited}
                  for t in RESOURCE_TYPE_IDS}
           for u in users}
    for a in CreditAllowance.objects.filter(user_id__in=out.keys()):
        out[a.user_id][a.resource_type] = {"limit": a.limit, "used": a.used, "remaining": a.remaining,
                                           "unlimited": a.user_id in unlimited}
    return out


def _guard(request, target: User, *, self_ok: bool = False) -> Optional[tuple]:
    """Refuse self-changes (unless self_ok) and changes to other admins by non-superusers."""
    if not self_ok and target.id == request.auth.id:
        return 400, {"detail": "You can't change your own account here. Ask another administrator."}
    if target.is_staff and target.id != request.auth.id and not request.auth.is_superuser:
        return 403, {"detail": "Only a superuser can change another administrator."}
    if target.is_superuser and not request.auth.is_superuser:
        return 403, {"detail": "Only a superuser can change a superuser."}
    return None


# ── stats ────────────────────────────────────────────────────────────────
@router.get("/stats")
def stats(request, days: int = 30):
    """Headline numbers plus daily signups, active users and generations."""
    days = max(1, min(int(days), 365))
    now = timezone.now()
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    users = User.objects.all()
    by_status = dict(UserProfile.objects.filter(user__is_staff=False)
                     .values_list("status").annotate(n=Count("id")))
    by_role = dict(UserProfile.objects.filter(user__is_staff=False)
                   .values_list("role").annotate(n=Count("id")))
    charged = UsageEvent.objects.filter(refunded=False)

    signups = dict(users.filter(date_joined__gte=since).annotate(d=TruncDate("date_joined"))
                   .values_list("d").annotate(n=Count("id")))
    gens = dict(charged.filter(created_at__gte=since).annotate(d=TruncDate("created_at"))
                .values_list("d").annotate(n=Count("id")))
    active = dict(charged.filter(created_at__gte=since).annotate(d=TruncDate("created_at"))
                  .values_list("d").annotate(n=Count("user_id", distinct=True)))
    series = []
    for i in range(days):
        d = (since + timedelta(days=i)).date()
        series.append({"date": d.isoformat(), "signups": signups.get(d, 0),
                       "generations": gens.get(d, 0), "active_users": active.get(d, 0)})

    def active_since(delta):
        """Count distinct users who logged in or generated something within `delta` of now."""
        cutoff = now - delta
        return users.filter(Q(last_login__gte=cutoff) | Q(usage_events__created_at__gte=cutoff)).distinct().count()

    return {
        "totals": {
            "users": users.count(),
            "admins": users.filter(is_staff=True).count(),
            "deactivated": users.filter(is_active=False).count(),
            "pending": by_status.get(UserProfile.STATUS_PENDING, 0),
            "approved": by_status.get(UserProfile.STATUS_APPROVED, 0) + users.filter(is_staff=True).count(),
            "rejected": by_status.get(UserProfile.STATUS_REJECTED, 0),
            "banned": by_status.get(UserProfile.STATUS_BANNED, 0),
            "teachers": by_role.get(UserProfile.ROLE_TEACHER, 0),
            "students": by_role.get(UserProfile.ROLE_STUDENT, 0),
            "active_1d": active_since(timedelta(days=1)),
            "active_7d": active_since(timedelta(days=7)),
            "active_30d": active_since(timedelta(days=30)),
            "generations": charged.count(),
            "generations_today": charged.filter(created_at__date=now.date()).count(),
            "signups_7d": users.filter(date_joined__gte=now - timedelta(days=7)).count(),
        },
        "generations_by_type": {t: n for t, n in charged.values_list("resource_type").annotate(n=Count("id"))},
        "series": series,
    }


# ── users ────────────────────────────────────────────────────────────────
@router.get("/users")
def list_users(request, q: str = "", status: str = "", role: str = "", active: str = "",
               page: int = 1, page_size: int = 25, sort: str = "-date_joined"):
    """Search by username/email/name; filter by status, role and active flag."""
    qs = User.objects.select_related("profile").annotate(
        generation_count=Count("usage_events", filter=Q(usage_events__refunded=False)))
    if q.strip():
        term = q.strip()
        qs = qs.filter(Q(username__icontains=term) | Q(email__icontains=term)
                       | Q(first_name__icontains=term) | Q(last_name__icontains=term))
    if status:
        if status == UserProfile.STATUS_APPROVED:
            qs = qs.filter(Q(profile__status=status) | Q(is_staff=True))
        else:
            qs = qs.filter(profile__status=status, is_staff=False)
    if role == "admin":
        qs = qs.filter(is_staff=True)
    elif role in (UserProfile.ROLE_TEACHER, UserProfile.ROLE_STUDENT):
        qs = qs.filter(profile__role=role, is_staff=False)
    if active in ("true", "false"):
        qs = qs.filter(is_active=(active == "true"))
    allowed_sorts = {"date_joined", "-date_joined", "username", "-username", "last_login", "-last_login",
                     "generation_count", "-generation_count"}
    qs = qs.order_by(sort if sort in allowed_sorts else "-date_joined", "id")

    page_size = max(1, min(int(page_size), PAGE_SIZE_MAX))
    total = qs.count()
    page = max(1, int(page))
    rows = list(qs[(page - 1) * page_size: page * page_size])
    credit_map = _credit_maps(rows)
    return {"total": total, "page": page, "page_size": page_size,
            "users": [_user_row(u, credit_map) for u in rows]}


@router.get("/users/{user_id}")
def user_detail(request, user_id: int):
    """
    Full profile of one user: credits, usage per resource type, token counters,
    the 25 most recent generations and audit entries targeting them. 404 if not found.
    """
    user = get_object_or_404(User.objects.select_related("profile"), id=user_id)
    get_profile(user)
    usage = {t: {"charged": 0, "refunded": 0} for t in RESOURCE_TYPE_IDS}
    for t, refunded, n in (UsageEvent.objects.filter(user=user)
                           .values_list("resource_type", "refunded").annotate(n=Count("id"))):
        usage[t]["refunded" if refunded else "charged"] += n
    recent = [{"id": e.id, "resource_type": e.resource_type, "created_at": e.created_at,
               "refunded": e.refunded}
              for e in UsageEvent.objects.filter(user=user)[:25]]
    audit = [_audit_row(a) for a in AuditLog.objects.filter(target=user)[:25]]
    row = _user_row(user)
    profile = user.profile
    row.update({
        "status_changed_at": profile.status_changed_at,
        "gemini_input_tokens": profile.gemini_input_tokens,
        "gemini_output_tokens": profile.gemini_output_tokens,
        "usage": usage,
        "recent_generations": recent,
        "audit": audit,
    })
    return row


class StatusIn(Schema):
    """Body for changing a user's waitlist/moderation status, with an optional reason."""
    status: Literal["pending", "approved", "rejected", "banned"]
    reason: str = ""


@router.post("/users/{user_id}/status", response={200: dict, 400: dict, 403: dict})
def change_status(request, user_id: int, data: StatusIn):
    """Approve / reject (waitlist), ban / unban, or put back on the waitlist."""
    user = get_object_or_404(User, id=user_id)
    if (err := _guard(request, user)):
        return err
    if user.is_staff:
        return 400, {"detail": "Administrators are always approved. Change their role first."}
    before = get_profile(user).status
    set_status(user, data.status, data.reason)
    _audit(request, f"user.status.{data.status}", user, before=before, after=data.status,
           reason=data.reason[:300])
    return {"user": _user_row(User.objects.select_related("profile").get(id=user.id))}


class ActiveIn(Schema):
    """Body for activating (true) or deactivating (false) an account."""
    active: bool


@router.post("/users/{user_id}/active", response={200: dict, 400: dict, 403: dict})
def set_active(request, user_id: int, data: ActiveIn):
    """Deactivate (blocks sign-in and every API call) or reactivate an account."""
    user = get_object_or_404(User, id=user_id)
    if (err := _guard(request, user)):
        return err
    if user.is_active != data.active:
        user.is_active = data.active
        user.save(update_fields=["is_active"])
        _audit(request, "user.activate" if data.active else "user.deactivate", user)
    return {"user": _user_row(User.objects.select_related("profile").get(id=user.id))}


class RoleIn(Schema):
    """Body for changing a user's role to student, teacher or admin."""
    role: Literal["student", "teacher", "admin"]


@router.post("/users/{user_id}/role", response={200: dict, 400: dict, 403: dict})
def change_role(request, user_id: int, data: RoleIn):
    """Student / teacher, or admin (staff). Only superusers grant or remove admin."""
    user = get_object_or_404(User, id=user_id)
    if (err := _guard(request, user)):
        return err
    before = _role_of(user)
    if before == data.role:
        return {"user": _user_row(User.objects.select_related("profile").get(id=user.id))}
    if (data.role == "admin" or user.is_staff) and not request.auth.is_superuser:
        return 403, {"detail": "Only a superuser can grant or remove administrator access."}
    with transaction.atomic():
        if data.role == "admin":
            user.is_staff = True
            user.save(update_fields=["is_staff"])
            set_role(user, UserProfile.ROLE_TEACHER)  # admins can create and share like teachers
            set_status(user, UserProfile.STATUS_APPROVED)
        else:
            if user.is_staff:
                user.is_staff = False
                user.save(update_fields=["is_staff"])
            set_role(user, data.role)
        _audit(request, "user.role", user, before=before, after=data.role)
    return {"user": _user_row(User.objects.select_related("profile").get(id=user.id))}


class CreditsIn(Schema):
    """Body for a credit change: grant, set or reset `amount` for one resource type or 'all'."""
    action: Literal["grant", "set", "reset"]
    resource_type: str = "all"  # one of RESOURCE_TYPE_IDS or "all"
    amount: int = 0


@router.post("/users/{user_id}/credits", response={200: dict, 400: dict, 403: dict})
def change_credits(request, user_id: int, data: CreditsIn):
    """
    grant: add `amount` credits; set: make remaining exactly `amount`;
    reset: clear usage and restore at least the default allowance.
    """
    user = get_object_or_404(User, id=user_id)
    if (err := _guard(request, user, self_ok=True)):
        return err
    if data.resource_type != "all" and data.resource_type not in RESOURCE_TYPE_IDS:
        return 400, {"detail": f"Unknown resource type '{data.resource_type}'"}
    if data.amount > 1000:
        return 400, {"detail": "That's too many credits at once (max 1000)."}
    before = credits.credit_summary(user)
    try:
        if data.action == "grant":
            credits.grant(user, data.resource_type, data.amount)
        elif data.action == "set":
            credits.set_remaining(user, data.resource_type, data.amount)
        else:
            credits.reset(user, data.resource_type)
    except ValueError as e:
        return 400, {"detail": str(e)}
    after = credits.credit_summary(user)
    _audit(request, f"credits.{data.action}", user, resource_type=data.resource_type,
           amount=data.amount,
           before={t: before[t]["remaining"] for t in before},
           after={t: after[t]["remaining"] for t in after})
    return {"credits": after}


# ── waitlist ─────────────────────────────────────────────────────────────
@router.get("/waitlist")
def waitlist(request, q: str = "", page: int = 1, page_size: int = 50):
    """Pending sign-ups, oldest first (first come, first served)."""
    qs = User.objects.select_related("profile").filter(profile__status=UserProfile.STATUS_PENDING,
                                                        is_staff=False)
    if q.strip():
        qs = qs.filter(Q(username__icontains=q.strip()) | Q(email__icontains=q.strip()))
    qs = qs.order_by("date_joined", "id")
    page_size = max(1, min(int(page_size), PAGE_SIZE_MAX))
    page = max(1, int(page))
    total = qs.count()
    rows = list(qs[(page - 1) * page_size: page * page_size])
    credit_map = _credit_maps(rows)
    return {"total": total, "page": page, "page_size": page_size,
            "users": [_user_row(u, credit_map) for u in rows]}


class BulkIn(Schema):
    """Body for bulk approving or rejecting waitlisted users by id."""
    user_ids: List[int]
    action: Literal["approve", "reject"]
    reason: str = ""


@router.post("/waitlist/bulk", response={200: dict, 400: dict})
def waitlist_bulk(request, data: BulkIn):
    """Approve or reject many waitlisted users at once (only pending users are changed)."""
    ids = list(dict.fromkeys(data.user_ids))[:500]
    if not ids:
        return 400, {"detail": "Select at least one user."}
    status = UserProfile.STATUS_APPROVED if data.action == "approve" else UserProfile.STATUS_REJECTED
    with transaction.atomic():
        # Lock the profiles and re-check "pending" inside the transaction, so a concurrent
        # ban/approval by another admin is never overwritten.
        locked = list(UserProfile.objects.select_for_update()
                      .filter(user_id__in=ids, user__is_staff=False, status=UserProfile.STATUS_PENDING)
                      .values_list("user_id", flat=True))
        users = list(User.objects.filter(id__in=locked).order_by("id"))
        for u in users:
            set_status(u, status, data.reason)
            # One entry per user, so it shows in that user's admin history too.
            _audit(request, f"user.status.{status}", u, before=UserProfile.STATUS_PENDING, after=status,
                   reason=data.reason[:300], via="waitlist", batch_size=len(users))
    return {"updated": len(users), "skipped": len(ids) - len(users)}


# ── usage ────────────────────────────────────────────────────────────────
@router.get("/usage")
def usage(request, days: int = 30, resource_type: str = ""):
    """Generations per resource type and the heaviest users in the window."""
    days = max(1, min(int(days), 365))
    since = timezone.now() - timedelta(days=days)
    events = UsageEvent.objects.filter(created_at__gte=since)
    if resource_type in RESOURCE_TYPE_IDS:
        events = events.filter(resource_type=resource_type)
    by_type = {t: {"charged": 0, "refunded": 0, "users": 0} for t in RESOURCE_TYPE_IDS}
    for t, refunded, n in events.values_list("resource_type", "refunded").annotate(n=Count("id")):
        by_type[t]["refunded" if refunded else "charged"] += n
    for t, n in (events.filter(refunded=False).values_list("resource_type")
                 .annotate(n=Count("user_id", distinct=True))):
        by_type[t]["users"] = n
    exhausted = {t: CreditAllowance.objects.filter(resource_type=t, used__gte=F("limit")).count()
                 for t in RESOURCE_TYPE_IDS}
    top = (events.filter(refunded=False).values("user_id", "user__username")
           .annotate(n=Count("id")).order_by("-n")[:20])
    return {
        "days": days,
        "by_type": by_type,
        "users_out_of_credits": exhausted,
        "top_users": [{"id": r["user_id"], "username": r["user__username"], "generations": r["n"]} for r in top],
    }


# ── audit log ────────────────────────────────────────────────────────────
def _audit_row(a: AuditLog) -> dict:
    """Serialize an AuditLog entry for the admin panel."""
    return {"id": a.id, "created_at": a.created_at, "actor": a.actor_username, "actor_id": a.actor_id,
            "action": a.action, "target": a.target_username, "target_id": a.target_id,
            "details": a.details, "ip_address": a.ip_address}


@router.get("/audit")
def audit_log(request, q: str = "", action: str = "", page: int = 1, page_size: int = 50):
    """Paginated audit log, newest first; filter by action prefix and actor/target username."""
    qs = AuditLog.objects.all()
    if action:
        qs = qs.filter(action__startswith=action)
    if q.strip():
        qs = qs.filter(Q(actor_username__icontains=q.strip()) | Q(target_username__icontains=q.strip()))
    page_size = max(1, min(int(page_size), PAGE_SIZE_MAX))
    page = max(1, int(page))
    total = qs.count()
    return {"total": total, "page": page, "page_size": page_size,
            "entries": [_audit_row(a) for a in qs[(page - 1) * page_size: page * page_size]]}
