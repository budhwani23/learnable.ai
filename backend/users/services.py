from dataclasses import dataclass
from math import ceil
from typing import Optional

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction

from .models import UserProfile


@dataclass
class DebitResult:
    """Outcome of a manual credit deduction."""
    debited: int
    remaining: int


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


@transaction.atomic
def add_credits(user: User, amount: int) -> int:
    """
    Add credits to a user's balance and return the new balance.
    Transactional to protect against race conditions.
    """
    profile = get_profile(user)
    profile.credits = max(0, profile.credits + int(amount))
    profile.save(update_fields=["credits", "updated_at"])
    return profile.credits


@transaction.atomic
def deduct_credits(user: User, amount: int) -> DebitResult:
    """
    Deduct a fixed number of credits from the user's balance.
    Raises ValueError if insufficient credits.
    Returns the amount debited and remaining balance.
    """
    amount = int(amount)
    if amount <= 0:
        return DebitResult(debited=0, remaining=get_profile(user).credits)

    profile = get_profile(user)
    if profile.credits < amount:
        raise ValueError("Insufficient credits")

    profile.credits -= amount
    profile.save(update_fields=["credits", "updated_at"])
    return DebitResult(debited=amount, remaining=profile.credits)


@transaction.atomic
def debit_credits_for_usage(
    user: User,
    input_tokens: Optional[int],
    output_tokens: Optional[int],
    min_debit: Optional[int] = None,
) -> int:
    """
    Compute and deduct credits based on Gemini usage tokens.

    Formula:
    - usage_credits = ceil((in_tokens / 1000) * in_rate + (out_tokens / 1000) * out_rate)
    - total_debit = max(min_debit, usage_credits)

    Also updates cumulative token counters for analytics.
    Returns the total number of credits debited.
    """
    in_tokens = int(input_tokens or 0)
    out_tokens = int(output_tokens or 0)

    in_rate = float(settings.CREDITS_PER_1K_INPUT_TOKENS)
    out_rate = float(settings.CREDITS_PER_1K_OUTPUT_TOKENS)
    minimum = int(min_debit if min_debit is not None else int(settings.MIN_CREDIT_DEBIT_PER_CALL))

    usage_credits = 0.0
    usage_credits += (in_tokens / 1000.0) * in_rate
    usage_credits += (out_tokens / 1000.0) * out_rate

    total_to_debit = max(minimum, ceil(usage_credits))

    profile = get_profile(user)
    if profile.credits < total_to_debit:
        raise ValueError("Insufficient credits")

    # Apply debit and update counters atomically
    profile.credits -= total_to_debit
    profile.gemini_input_tokens += in_tokens
    profile.gemini_output_tokens += out_tokens
    profile.save(update_fields=[
        "credits",
        "gemini_input_tokens",
        "gemini_output_tokens",
        "updated_at",
    ])

    return total_to_debit 