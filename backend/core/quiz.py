"""Helpers shared by quiz generation and grading."""
import re
from typing import Any, Dict, List, Optional

_LETTER = re.compile(r"^\(?([A-Za-z])[).:]?(\s|$)")
# "Option A: text", "A) text", "b. text" -> "text"
_OPTION_PREFIX = re.compile(r"^\s*(?:option\s*)?\(?[A-Da-d]\)?\s*[.):\-]\s+", re.IGNORECASE)


def correct_index(question: Dict[str, Any]) -> int:
    """
    Index of the correct option. `correct_answer` is usually a letter ("B"), but models
    sometimes return the option text ("Chloroplasts") or "B) Chloroplasts". Returns -1
    when it can't be resolved.
    """
    options: List[str] = [str(o) for o in (question.get("options") or [])]
    answer = str(question.get("correct_answer") or "").strip()
    if not answer or not options:
        return -1
    lowered = [clean_option(o).lower() for o in options]
    if clean_option(answer).lower() in lowered:
        return lowered.index(clean_option(answer).lower())
    m = _LETTER.match(answer)
    if m:
        idx = ord(m.group(1).upper()) - 65
        if 0 <= idx < len(options):
            return idx
    return -1


def clean_option(text: Optional[str]) -> str:
    """Strip a leading letter label the model sometimes adds to option text."""
    return _OPTION_PREFIX.sub("", str(text or "")).strip()


def normalize_question(question: Dict[str, Any]) -> Dict[str, Any]:
    """Clean option labels and store the correct answer as a letter."""
    options = [clean_option(o) for o in (question.get("options") or [])]
    idx = correct_index({**question, "options": options})
    out = {**question, "options": options}
    if idx >= 0:
        out["correct_answer"] = chr(65 + idx)
    return out
