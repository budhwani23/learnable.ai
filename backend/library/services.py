from typing import List, Optional, Tuple

from django.contrib.auth.models import User

from core.quiz import correct_index

from .models import LearningResource, ResourceAccess


def can_view(user: User, resource: LearningResource) -> bool:
    """Owner, a student granted access (LMS launch / opened link), or anyone signed in if sharing is on."""
    if resource.owner_id == user.id or resource.share_enabled:
        return True
    return ResourceAccess.objects.filter(user=user, resource=resource).exists()


def grant_access(user: User, resource: LearningResource, via: str) -> None:
    if user.id != resource.owner_id:
        ResourceAccess.objects.get_or_create(user=user, resource=resource, defaults={"granted_via": via})


def grade_quiz(resource: LearningResource, answers: List[Optional[str]]) -> Tuple[int, int]:
    """
    Grade on the server from the stored quiz so a student can't post a fake score.
    `answers` are the chosen option texts (what the quiz UI records), one per question.
    `correct_answer` is a letter A-D, or occasionally the option text itself.
    """
    questions = (resource.payload or {}).get("quiz") or []
    score = 0
    for i, q in enumerate(questions):
        given = answers[i] if i < len(answers) else None
        options = q.get("options") or []
        idx = correct_index(q)
        if given is not None and 0 <= idx < len(options) and given == options[idx]:
            score += 1
    return score, len(questions)
