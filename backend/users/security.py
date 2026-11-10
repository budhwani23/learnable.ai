from typing import Optional

from django.contrib.auth.models import User
from ninja.security import HttpBearer

from .auth import decode_token


class AccountBlocked(Exception):
    """
    The token is valid but the account may not use this endpoint (waitlist, banned,
    deactivated, not an admin). Rendered as 403 {"detail", "code"} by the handler in api/api.py.
    """

    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(detail)


def account_block(user: User) -> Optional[AccountBlocked]:
    """Why this user can't use the app right now, or None if they can."""
    from .services import get_profile  # avoid import cycle at module load
    from .models import UserProfile

    if not user.is_active:
        return AccountBlocked("account_deactivated",
                              "This account has been deactivated. Contact support if you think this is a mistake.")
    if user.is_staff:
        return None  # admins are always approved
    profile = get_profile(user)
    if profile.status == UserProfile.STATUS_PENDING:
        return AccountBlocked("waitlist",
                              "You're on the waitlist. We'll let you in as soon as an administrator approves your account.")
    if profile.status == UserProfile.STATUS_REJECTED:
        return AccountBlocked("rejected", "Your request to join was not approved."
                              + (f" Reason: {profile.status_reason}" if profile.status_reason else ""))
    if profile.status == UserProfile.STATUS_BANNED:
        return AccountBlocked("banned", "This account has been banned."
                              + (f" Reason: {profile.status_reason}" if profile.status_reason else ""))
    return None


class JWTAuth(HttpBearer):
    """
    Ninja HTTP Bearer security scheme that authenticates requests using JWTs.
    - Reads Authorization: Bearer <token>
    - Verifies token signature and expiry, and that it's an 'access' token
    - By default also requires an approved, active account (waitlist gate);
      `allow_unapproved=True` lets waitlisted users through (e.g. /auth/me)
    - Returns the Django User instance as request.auth
    """

    def __init__(self, allow_unapproved: bool = False, require_staff: bool = False):
        super().__init__()
        self.allow_unapproved = allow_unapproved
        self.require_staff = require_staff

    def authenticate(self, request, token: str) -> Optional[User]:
        try:
            payload = decode_token(token)
            if payload.get("type") != "access":
                return None
            user = User.objects.select_related("profile").get(id=int(payload.get("sub")))
        except Exception:
            # Any exception (invalid signature, expired, user missing) => unauthenticated
            return None
        if not user.is_active:
            # Deactivated accounts lose all access, including /auth/me.
            raise account_block(user)
        if not self.allow_unapproved and (block := account_block(user)):
            raise block
        if self.require_staff and not user.is_staff:
            raise AccountBlocked("admin_only", "Only administrators can do that.")
        return user


# Reusable singleton instances for route decorators
jwt_auth = JWTAuth()
# Signed-in users whatever their waitlist status (only for /auth/me and similar).
jwt_auth_any = JWTAuth(allow_unapproved=True)
# Admin/staff only.
admin_auth = JWTAuth(require_staff=True)
