from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

Role = Literal["teacher", "student"]


def _strip(value):
    return value.strip() if isinstance(value, str) else value


class RegisterIn(BaseModel):
    """Schema for user registration payload."""
    username: str = Field(min_length=3, max_length=150)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Role = "student"

    # Trim before the length checks so "  ab  " is still too short.
    @field_validator("username", "email", mode="before")
    @classmethod
    def trim_fields(cls, value):
        return _strip(value)


class LoginIn(BaseModel):
    """
    Schema for user login payload. `role` is the sign-in page used (teacher or
    student); when given, the account must have that role.
    """
    username: str
    password: str
    role: Optional[Role] = None

    @field_validator("username", mode="before")
    @classmethod
    def trim_username(cls, value):
        return _strip(value)


class GoogleLoginIn(BaseModel):
    """Google Sign-In ID token (credential) from Google Identity Services."""
    credential: str
    # Role for a new account; checked against an existing one. Omitted = student / any.
    role: Optional[Role] = None


class TokenOut(BaseModel):
    """Response schema for token pair."""
    access: str
    refresh: str


class UserOut(BaseModel):
    """Public user info together with current credits."""
    id: int
    username: str
    # Plain str: users created from an LMS launch may have no email shared by the LMS.
    email: str = ""
    credits: int
    role: Role


class CreditChangeIn(BaseModel):
    """Schema to add or deduct credits in a simple way."""
    amount: int


class ErrorOut(BaseModel):
    """Standard error response with detail message."""
    detail: str 