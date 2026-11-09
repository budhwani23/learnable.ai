from unittest import mock

from django.contrib.auth.models import User
from django.test import Client, SimpleTestCase, TestCase

from core.quiz import clean_option, correct_index, normalize_question
from library.models import LearningResource
from library.services import grade_quiz
from users.auth import create_tokens


class QuizHelperTests(SimpleTestCase):
    OPTIONS = ["Mitochondria", "Chloroplasts", "Nucleus", "Ribosomes"]

    def test_correct_index_accepts_letters_labels_and_text(self):
        for answer, expected in [("B", 1), ("b)", 1), ("(B)", 1), ("Chloroplasts", 1), ("chloroplasts ", 1),
                                 ("B. Chloroplasts", 1), ("D", 3), ("Z", -1), ("", -1)]:
            self.assertEqual(correct_index({"options": self.OPTIONS, "correct_answer": answer}), expected, answer)

    def test_text_answer_starting_with_another_letter_is_not_read_as_that_letter(self):
        # "Chloroplasts" starts with C, but the right option is B.
        self.assertEqual(correct_index({"options": self.OPTIONS, "correct_answer": "Chloroplasts"}), 1)

    def test_clean_option_strips_labels_only(self):
        self.assertEqual(clean_option("Option A: To absorb oxygen"), "To absorb oxygen")
        self.assertEqual(clean_option("b) Releases oxygen"), "Releases oxygen")
        self.assertEqual(clean_option("A cell wall"), "A cell wall")
        self.assertEqual(clean_option("Absorbs light"), "Absorbs light")

    def test_normalize_question(self):
        q = normalize_question({"question": "?", "options": ["Option A: x", "Option B: y"], "correct_answer": "y"})
        self.assertEqual(q["options"], ["x", "y"])
        self.assertEqual(q["correct_answer"], "B")


class GradingTests(TestCase):
    def test_grades_text_and_letter_answers(self):
        owner = User.objects.create_user("t", password="x" * 10)
        quiz = {"quiz": [
            {"question": "Where?", "options": QuizHelperTests.OPTIONS, "correct_answer": "Chloroplasts"},
            {"question": "Gas?", "options": ["Oxygen", "Nitrogen"], "correct_answer": "A"},
        ]}
        r = LearningResource.objects.create(owner=owner, type="quiz", title="Q", payload=quiz)
        self.assertEqual(grade_quiz(r, ["Chloroplasts", "Oxygen"]), (2, 2))
        self.assertEqual(grade_quiz(r, ["Nucleus", "Oxygen"]), (1, 2))


class GenerationErrorStatusTests(TestCase):
    """Failed generations must not be reported as HTTP 200."""

    def setUp(self):
        user = User.objects.create_user("gen", password="x" * 10)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {create_tokens(user.id, user.username)[0]}"}

    def test_missing_content_is_400(self):
        r = Client().post("/api/learning/summarize-content", {"data": "{}"}, **self.auth)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("error", r.json())

    def test_ai_quota_error_is_503_with_a_readable_message(self):
        quota = (None, "Error summarizing text: 429 You exceeded your current quota, please check your plan.")
        with mock.patch("learning.api.media_processor.summarize_text", return_value=quota):
            r = Client().post("/api/learning/summarize-content", {"data": '{"text": "Photosynthesis basics."}'}, **self.auth)
        self.assertEqual(r.status_code, 503, r.content)
        self.assertIn("out of quota", r.json()["error"])

    def test_successful_response_keeps_200(self):
        with mock.patch("learning.api.media_processor.summarize_text", return_value=("A short summary.", None)):
            r = Client().post("/api/learning/summarize-content", {"data": '{"text": "Photosynthesis basics."}'}, **self.auth)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["summary"], "A short summary.")
