"""
Learning service for mindmaps, MCQs, and flashcards generation.
"""
import json
import logging
from typing import Dict, Any, List, Optional
from ninja.files import UploadedFile
from core.gemini import GeminiService
from core.quiz import normalize_question
from constants import (
    MINDMAP_GENERATION_PROMPT, FLASHCARD_GENERATION_PROMPT, get_mcq_quiz_prompt,
    TOPIC_EXTRACTION_PROMPT,
    YOUTUBE_URL_SUMMARY_PROMPT, YOUTUBE_URL_MINDMAP_PROMPT, YOUTUBE_URL_FLASHCARD_PROMPT
)
from schema import (
    MCQQuizStructuredOutput, MCQQuestion, MindmapNode
)
from utils.youtube import is_youtube_url, get_youtube_transcript

logger = logging.getLogger(__name__)


class LearningService:
    """Handles learning content generation operations."""

    def __init__(self, gemini_service: GeminiService, text_service: GeminiService | None = None):
        # Gemini LLM service wrapper
        self.gemini_service = gemini_service
        # Plain-text generation (may be Cerebras); URL-based methods stay on Gemini,
        # which can open and watch YouTube links.
        self.text_service = text_service or gemini_service

    # ==============================
    # URL-based generation methods
    # ==============================

    def summarize_from_url(self, url: str) -> Dict[str, Any]:
        """
        Summarize a YouTube video by providing only the URL to Gemini.
        Returns a dict with success status and summary or error message.
        """
        try:
            # Instruct Gemini to access/analyze the URL and produce a summary
            summary_text = self.gemini_service.run_prompt(YOUTUBE_URL_SUMMARY_PROMPT, url)
            summary_text = summary_text.strip()
            if not summary_text:
                return {"success": False, "error": "Empty summary returned from model."}
            return {"success": True, "summary": summary_text}
        except Exception as e:
            return {"success": False, "error": f"Error summarizing from URL: {str(e)}"}

    def mindmap_from_url(self, url: str) -> Dict[str, Any]:
        """
        Generate a mindmap JSON structure by giving Gemini the YouTube URL directly.
        """
        try:
            # Ask Gemini for JSON-only mindmap
            mindmap_json = self.gemini_service.run_prompt(YOUTUBE_URL_MINDMAP_PROMPT, url)
            mindmap_json = self._clean_json_response(mindmap_json)
            mindmap_data = json.loads(mindmap_json)
            return {
                "success": True,
                "mindmap": MindmapNode(**mindmap_data)
            }
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Failed to parse mindmap JSON: {str(e)}."}
        except Exception as e:
            return {"success": False, "error": f"Error generating mindmap from URL: {str(e)}"}

    def flashcards_from_url(self, url: str) -> Dict[str, Any]:
        """
        Generate flashcards (JSON array) by giving Gemini the YouTube URL directly.
        """
        try:
            flashcards_json = self.gemini_service.run_prompt(YOUTUBE_URL_FLASHCARD_PROMPT, url)
            flashcards_json = self._clean_json_response(flashcards_json)
            flashcards_list = json.loads(flashcards_json)
            if not isinstance(flashcards_list, list):
                return {"success": False, "error": "Model did not return a JSON array for flashcards."}
            return {
                "success": True,
                "flashcards": flashcards_list,
                "total_cards": len(flashcards_list)
            }
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Failed to parse flashcards JSON: {str(e)}."}
        except Exception as e:
            return {"success": False, "error": f"Error generating flashcards from URL: {str(e)}"}

    def mcq_from_url(self, url: str, num_questions: int = 10) -> Dict[str, Any]:
        """
        Generate MCQ quiz questions by giving Gemini the YouTube URL directly.
        Uses structured output schema for robust parsing.
        """
        try:
            prompt = (
                f"Access and analyze the content at the following YouTube URL and create {num_questions} "
                f"multiple choice questions with explanations. URL: {url}"
            )
            questions = self._invoke_mcq(prompt, num_questions, service=self.gemini_service)

            return {
                "success": True,
                "quiz": questions
            }
        except Exception as e:
            return {"success": False, "error": f"Error generating MCQ quiz from URL: {str(e)}"}

    # ==============================
    # Existing content extraction and generation
    # ==============================

    def _get_content_from_source(
        self,
        text_input: Optional[str] = None,
        audio_file: Optional[UploadedFile] = None,
        video_file: Optional[UploadedFile] = None,
        document_file: Optional[UploadedFile] = None,
        media_processor=None
    ) -> tuple[str | None, str | None, str | None]:
        """
        Determines the source of content and extracts text.
        Handles text, YouTube URLs, and file uploads.
        """
        # Check for YouTube URL first
        if text_input and is_youtube_url(text_input):
            transcript, error = get_youtube_transcript(text_input)
            if error:
                return None, "youtube", error
            return transcript, "youtube", None

        # Then check for other inputs
        if audio_file:
            content, error = media_processor.extract_content_from_media(audio_file=audio_file)
            return content, "audio", error
        elif video_file:
            content, error = media_processor.extract_content_from_media(video_file=video_file)
            return content, "video", error
        elif document_file:
            content, error = media_processor.extract_content_from_media(document_file=document_file)
            return content, "document", error
        elif text_input and text_input.strip():
            return text_input, "text", None

        return None, None, "No valid content source provided. Please provide text, a YouTube URL, or a file."

    def generate_mindmap_from_multimedia(
        self,
        topic: Optional[str] = None,
        audio_file: Optional[UploadedFile] = None,
        video_file: Optional[UploadedFile] = None,
        document_file: Optional[UploadedFile] = None,
        media_processor=None
    ) -> Dict[str, Any]:
        """
        Generate mindmap from multimedia content, including YouTube URLs.
        """
        try:
            content, content_type, error = self._get_content_from_source(
                text_input=topic,
                audio_file=audio_file,
                video_file=video_file,
                document_file=document_file,
                media_processor=media_processor
            )
            if error:
                return {"success": False, "error": error}

            extracted_topic = self.text_service.run_prompt(TOPIC_EXTRACTION_PROMPT, content)
            extracted_topic = extracted_topic.strip().strip('"').strip("'")
            
            mindmap_json = self.text_service.run_prompt(MINDMAP_GENERATION_PROMPT, content)
            mindmap_json = self._clean_json_response(mindmap_json)
            
            mindmap_data = json.loads(mindmap_json)
            return {
                "success": True,
                "mindmap": MindmapNode(**mindmap_data),
                "content_type": content_type,
                "content": content,
                "extracted_topic": extracted_topic
            }
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Failed to parse mindmap JSON: {str(e)}."}
        except Exception as e:
            return {"success": False, "error": f"Error generating mindmap: {str(e)}"}

    def generate_mcq_quiz_from_multimedia(
        self,
        content: Optional[str] = None,
        num_questions: int = 10,
        audio_file: Optional[UploadedFile] = None,
        video_file: Optional[UploadedFile] = None,
        document_file: Optional[UploadedFile] = None,
        media_processor=None
    ) -> Dict[str, Any]:
        """
        Generate MCQ quiz from multimedia content, including YouTube URLs.
        """
        try:
            content_text, content_type, error = self._get_content_from_source(
                text_input=content,
                audio_file=audio_file,
                video_file=video_file,
                document_file=document_file,
                media_processor=media_processor
            )
            if error:
                return {"success": False, "error": error}

            prompt = f"{get_mcq_quiz_prompt(num_questions)}\n\nContent:\n{content_text}"
            questions = self._invoke_mcq(prompt, num_questions)

            return {
                "success": True,
                "quiz": questions,
                "content_type": content_type,
                "content": content_text
            }
        except Exception as e:
            return {"success": False, "error": f"Error generating MCQ quiz: {str(e)}"}

    def generate_flashcards_from_multimedia(
        self,
        content: Optional[str] = None,
        audio_file: Optional[UploadedFile] = None,
        video_file: Optional[UploadedFile] = None,
        document_file: Optional[UploadedFile] = None,
        media_processor=None
    ) -> Dict[str, Any]:
        """
        Generate flashcards from multimedia content, including YouTube URLs.
        """
        try:
            content_text, content_type, error = self._get_content_from_source(
                text_input=content,
                audio_file=audio_file,
                video_file=video_file,
                document_file=document_file,
                media_processor=media_processor
            )
            if error:
                return {"success": False, "error": error}

            flashcards_json = self.text_service.run_prompt(FLASHCARD_GENERATION_PROMPT, content_text)
            flashcards_json = self._clean_json_response(flashcards_json)
            
            flashcards_data = json.loads(flashcards_json)
            return {
                "success": True,
                "flashcards": flashcards_data,
                "total_cards": len(flashcards_data),
                "content_type": content_type,
                "content": content_text
            }
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Failed to parse flashcards JSON: {str(e)}."}
        except Exception as e:
            return {"success": False, "error": f"Error generating flashcards: {str(e)}"}

    def _clean_json_response(self, response: str) -> str:
        """Helper to clean up JSON responses from the LLM."""
        response = response.strip()
        if response.startswith("```json"):
            response = response[7:]
        if response.startswith("```"):
            response = response[3:]
        if response.endswith("```"):
            response = response[:-3]
        return response.strip()

    def _invoke_mcq(self, task_prompt: str, num_questions: int, service: GeminiService | None = None) -> List[MCQQuestion]:
        """
        Generate MCQ questions from a fully-formed task prompt.

        Tries LangChain structured output first. Gemini's structured output can
        return ``None`` when the model does not emit a tool/function call, which
        previously caused ``'NoneType' object has no attribute 'questions'``.
        When that happens we fall back to requesting raw JSON and parsing it.
        """
        service = service or self.text_service
        try:
            structured_llm = service.llm.with_structured_output(MCQQuizStructuredOutput)
            result = structured_llm.invoke(task_prompt)
        except Exception as exc:  # e.g. a provider without tool/JSON-schema support
            logger.warning("Structured MCQ output failed (%s); falling back to raw JSON", str(exc)[:200])
            result = None

        if result is not None and getattr(result, "questions", None):
            return self._normalize_mcq([
                MCQQuestion(
                    question=q.question,
                    options=[q.option_a, q.option_b, q.option_c, q.option_d],
                    correct_answer=q.correct_answer,
                    explanation=q.explanation,
                )
                for q in result.questions
            ])

        # Fallback: ask for raw JSON and parse it manually.
        json_prompt = (
            f"{task_prompt}\n\n"
            "CRITICAL: Return ONLY a valid JSON array, with no other text or markdown. "
            f"Create exactly {num_questions} questions. Each array element must use this exact shape:\n"
            '{"question": "Where does photosynthesis take place?", "options": ["Mitochondria", '
            '"Chloroplasts", "Nucleus", "Ribosomes"], "correct_answer": "B", "explanation": "..."}\n'
            "Option strings are the answer text only: no 'A)', 'Option A:' or similar labels. "
            "correct_answer is the letter of the right option."
        )
        raw = service.run_raw(json_prompt)
        cleaned = self._clean_json_response(raw if isinstance(raw, str) else str(raw))
        data = json.loads(cleaned)
        if isinstance(data, dict) and "questions" in data:
            data = data["questions"]

        questions = [
            MCQQuestion(
                question=item["question"],
                options=item["options"],
                correct_answer=item["correct_answer"],
                explanation=item.get("explanation", ""),
            )
            for item in data
        ]
        if not questions:
            raise ValueError("Model returned no questions.")
        return self._normalize_mcq(questions)

    @staticmethod
    def _normalize_mcq(questions: List[MCQQuestion]) -> List[MCQQuestion]:
        """Strip "Option A:"-style labels from options and store the answer as a letter."""
        return [MCQQuestion(**normalize_question(q.model_dump())) for q in questions]
    
    def generate_mindmap(self, topic: str) -> Dict[str, Any]:
        """
        Generate mindmap JSON structure for a given topic.
        
        Returns:
            Dict with success status and mindmap data or error message
        """
        try:
            mindmap_json = self.text_service.run_prompt(MINDMAP_GENERATION_PROMPT, topic)
            
            # Clean the response - remove any leading/trailing whitespace and common prefixes
            mindmap_json = mindmap_json.strip()
            
            # Remove common prefixes that LLMs sometimes add
            if mindmap_json.startswith("```json"):
                mindmap_json = mindmap_json[7:]
            if mindmap_json.startswith("```"):
                mindmap_json = mindmap_json[3:]
            if mindmap_json.endswith("```"):
                mindmap_json = mindmap_json[:-3]
            
            mindmap_json = mindmap_json.strip()
            
            # Parse and validate JSON
            mindmap_data = json.loads(mindmap_json)
            return {
                "success": True,
                "mindmap": MindmapNode(**mindmap_data)
            }
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "error": f"Failed to parse mindmap JSON: {str(e)}. Raw response: {mindmap_json[:200]}..."
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating mindmap: {str(e)}"
            }
    
    def generate_mcq_quiz(self, content: str, num_questions: int) -> Dict[str, Any]:
        """
        Generate MCQ quiz questions using structured output.
        
        Returns:
            Dict with success status and quiz data or error message
        """
        try:
            simple_prompt = f"""
            Based on the following content, create {num_questions} multiple choice questions.
            
            Content: {content}
            
            Create questions that are:
            - Clear and relevant to the content
            - Have plausible options with only one correct answer
            - Include helpful explanations
            - Cover different aspects of the content
            """

            questions = self._invoke_mcq(simple_prompt, num_questions)

            return {
                "success": True,
                "quiz": questions
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating MCQ quiz: {str(e)}"
            }
    
    def generate_flashcards(self, content: str) -> Dict[str, Any]:
        """
        Generate flashcards for the given content.
        
        Returns:
            Dict with success status and flashcards data or error message
        """
        try:
            flashcards_json = self.text_service.run_prompt(FLASHCARD_GENERATION_PROMPT, content)
            
            # Clean the response - remove any leading/trailing whitespace and common prefixes
            flashcards_json = flashcards_json.strip()
            
            # Remove common prefixes that LLMs sometimes add
            if flashcards_json.startswith("```json"):
                flashcards_json = flashcards_json[7:]
            if flashcards_json.startswith("```"):
                flashcards_json = flashcards_json[3:]
            if flashcards_json.endswith("```"):
                flashcards_json = flashcards_json[:-3]
            
            flashcards_json = flashcards_json.strip()
            
            # Parse and validate JSON
            flashcards_data = json.loads(flashcards_json)
            return {
                "success": True,
                "flashcards": flashcards_data,
                "total_cards": len(flashcards_data)
            }
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "error": f"Failed to parse flashcards JSON: {str(e)}. Raw response: {flashcards_json[:200]}..."
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating flashcards: {str(e)}"
            } 