import json
from typing import Optional

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import IntegrityError
from ninja.router import Router

from .schemas import RegisterIn, LoginIn, GoogleLoginIn, TokenOut, UserOut, CreditChangeIn, ErrorOut
from .auth import create_tokens, decode_token
from .security import jwt_auth
from .services import add_credits, deduct_credits, get_profile, get_role, set_role

# Router that will be mounted under /api/users
router = Router()

_ROLE_LABEL = {"teacher": "a teacher", "student": "a student"}


def _wrong_portal(user: User, wanted: str | None):
    """403 body when an account signs in through the other role's sign-in page, else None."""
    actual = get_role(user)
    if wanted and wanted != actual:
        return {"detail": f"This is {_ROLE_LABEL[actual]} account. Use the {actual} sign-in instead."}
    return None


@router.post("/auth/register", response={200: TokenOut, 409: ErrorOut})
def register(request, payload: RegisterIn):
    """
    Register a new user account.
    - Creates Django user
    - Signals auto-provision a UserProfile
    - Returns access and refresh tokens
    """
    try:
        user = User.objects.create_user(
            username=payload.username,
            email=payload.email,
            password=payload.password,
        )
    except IntegrityError:
        # Username already exists
        return 409, {"detail": "Username already exists"}
    set_role(user, payload.role)

    access, refresh = create_tokens(user.id, user.username)
    return {"access": access, "refresh": refresh}


@router.post("/auth/login", response={200: TokenOut, 401: ErrorOut, 403: ErrorOut})
def login(request, payload: LoginIn):
    """
    Authenticate with username and password.
    Returns a fresh token pair on success. With `role`, the account must have that role.
    """
    user = authenticate(username=payload.username, password=payload.password)
    if not user:
        return 401, {"detail": "Invalid credentials"}
    if (err := _wrong_portal(user, payload.role)):
        return 403, err

    access, refresh = create_tokens(user.id, user.username)
    return {"access": access, "refresh": refresh}


@router.post("/auth/google", response={200: TokenOut, 401: ErrorOut, 403: ErrorOut, 503: ErrorOut})
def google_login(request, payload: GoogleLoginIn):
    """
    Sign in with a Google ID token (used by students opening a link shared to
    Google Classroom). Matches an existing account by verified email, else creates one.
    """
    from django.conf import settings
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    client_id = settings.GOOGLE_OAUTH_CLIENT_ID
    if not client_id:
        return 503, {"detail": "Google Sign-In is not configured on this server"}
    try:
        info = id_token.verify_oauth2_token(payload.credential, google_requests.Request(), client_id)
    except ValueError:
        return 401, {"detail": "Invalid Google sign-in"}
    email = (info.get("email") or "").lower()
    if not email or not info.get("email_verified"):
        return 401, {"detail": "Your Google account email is not verified"}

    # Only reuse accounts that were themselves created by Google sign-in (no usable
    # password). Password accounts are registered with unverified emails, so matching
    # them would let someone pre-register a student's email and capture their activity.
    user = next((u for u in User.objects.filter(email__iexact=email).order_by("id")
                 if not u.has_usable_password() and not u.lti_links.exists()), None)
    if not user:
        base = email.split("@")[0][:140] or "student"
        username, n = base, 1
        while User.objects.filter(username=username).exists():
            n += 1
            username = f"{base}{n}"
        user = User(username=username, email=email,
                    first_name=(info.get("given_name") or "")[:150],
                    last_name=(info.get("family_name") or "")[:150])
        user.set_unusable_password()
        user.save()
        set_role(user, payload.role or "student")
    elif (err := _wrong_portal(user, payload.role)):
        return 403, err

    access, refresh = create_tokens(user.id, user.username)
    return {"access": access, "refresh": refresh}


@router.post("/auth/refresh", response={200: TokenOut, 401: ErrorOut})
def refresh(request, refresh: Optional[str] = None):
    """
    Exchange a valid refresh token for a new pair of tokens.
    Accepts the token as a JSON body {"refresh": "..."} (what the frontend sends)
    or as a ?refresh= query parameter.
    """
    token = refresh
    if not token and request.body:
        try:
            body = json.loads(request.body)
            token = body.get("refresh") if isinstance(body, dict) else None
        except (ValueError, UnicodeDecodeError):
            token = None
    if not token:
        return 401, {"detail": "Refresh token required"}
    try:
        payload = decode_token(token)
        if payload.get("type") != "refresh":
            return 401, {"detail": "Invalid token type"}

        user_id = int(payload.get("sub"))
        user = User.objects.filter(id=user_id).first()
        if not user:
            return 401, {"detail": "User not found"}

        access, new_refresh = create_tokens(user.id, user.username)
        return {"access": access, "refresh": new_refresh}
    except Exception:
        return 401, {"detail": "Invalid or expired refresh token"}


@router.get("/auth/me", auth=jwt_auth, response=UserOut)
def me(request):
    """
    Return the authenticated user's profile with current credit balance.
    """
    user = request.auth
    profile = get_profile(user)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "credits": profile.credits,
        "role": profile.role,
    }


_STAFF_ONLY = {"detail": "Only administrators can change credit balances."}


@router.post("/credits/add", auth=jwt_auth, response={200: dict, 400: ErrorOut, 403: ErrorOut})
def credits_add(request, payload: CreditChangeIn):
    """
    Add credits to the current user. Staff only: ordinary users must not be able
    to grant themselves credits (payments should credit accounts server-side).
    """
    if not request.auth.is_staff:
        return 403, _STAFF_ONLY
    if payload.amount <= 0:
        return 400, {"detail": "Amount must be positive"}

    new_balance = add_credits(request.auth, payload.amount)
    return {"credits": new_balance}


@router.post("/credits/deduct", auth=jwt_auth, response={200: dict, 400: ErrorOut, 403: ErrorOut})
def credits_deduct(request, payload: CreditChangeIn):
    """
    Deduct credits from the current user (manual operation, staff only).
    """
    if not request.auth.is_staff:
        return 403, _STAFF_ONLY
    if payload.amount <= 0:
        return 400, {"detail": "Amount must be positive"}

    try:
        result = deduct_credits(request.auth, payload.amount)
        return {"debited": result.debited, "remaining": result.remaining}
    except ValueError as e:
        return 400, {"detail": str(e)} 