import time
from typing import Tuple

import jwt  # PyJWT
from django.conf import settings


def _now() -> int:
    """Return current epoch time in seconds."""
    return int(time.time())


def create_tokens(user_id: int, username: str) -> Tuple[str, str]:
    """
    Create a new pair of JWT tokens for a user.
    - Access token: used to call protected APIs; short-lived
    - Refresh token: exchanged for new access tokens; longer-lived
    """
    now = _now()

    # Claims for access token
    access_payload = {
        "sub": str(user_id),  # subject is the user id
        "username": username,
        "type": "access",
        "iat": now,  # issued at
        "exp": now + int(settings.JWT_ACCESS_TTL_SECONDS),  # expiry
    }

    # Claims for refresh token
    refresh_payload = {
        "sub": str(user_id),
        "username": username,
        "type": "refresh",
        "iat": now,
        "exp": now + int(settings.JWT_REFRESH_TTL_SECONDS),
    }

    access = jwt.encode(access_payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    refresh = jwt.encode(refresh_payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return access, refresh


def decode_token(token: str):
    """
    Decode and validate a JWT.
    Raises on invalid signature or expiration.
    """
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]) 