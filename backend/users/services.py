from django.contrib.auth.models import User

from .models import UserProfile


def get_profile(user: User) -> UserProfile:
    """
    Retrieve or create the profile for a given user.
    Ensures downstream code can rely on the presence of a profile.
    """
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return profile


def get_role(user: User) -> str:
    return get_profile(user).role


def is_teacher(user: User) -> bool:
    return get_profile(user).is_teacher


def set_role(user: User, role: str) -> None:
    if role not in dict(UserProfile.ROLES):
        raise ValueError(f"Unknown role '{role}'")
    profile = get_profile(user)
    if profile.role != role:
        profile.role = role
        profile.save(update_fields=["role", "updated_at"])


def set_status(user: User, status: str, reason: str = "") -> UserProfile:
    """Move an account between waitlist states (pending/approved/rejected/banned)."""
    from django.utils import timezone

    if status not in dict(UserProfile.STATUSES):
        raise ValueError(f"Unknown status '{status}'")
    profile = get_profile(user)
    profile.status = status
    profile.status_reason = (reason or "")[:300] if status in (UserProfile.STATUS_REJECTED,
                                                               UserProfile.STATUS_BANNED) else ""
    profile.status_changed_at = timezone.now()
    profile.save(update_fields=["status", "status_reason", "status_changed_at", "updated_at"])
    return profile
