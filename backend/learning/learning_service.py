"""
Learning service for mindmaps, MCQs, and flashcards generation.
"""
import json
import logging
import os
from typing import Dict, Any, List, Optional
from langchain_core.messages import HumanMessage, SystemMessage
from ninja.files import UploadedFile
from core.gemini import GeminiService
from core.quiz import normalize_question
from constants import (
    MINDMAP_GENERATION_PROMPT, FLASHCARD_GENERATION_PROMPT, get_mcq_quiz_prompt,
    TOPIC_EXTRACTION_PROMPT, SUMMARIZER_SYSTEM_MESSAGE, STRUCTURED_SUMMARY_FORMAT,
    TRANSCRIBER_SYSTEM_MESSAGE,
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
        # Plain-text generation (may be Cerebras). Gemini only watches YouTube videos
        # whose transcript cannot be fetched.
        self.text_service = text_service or gemini_service

    # ==============================
    # URL-based generation methods
    # ==============================
    # YouTube links: fetch the transcript and run the normal text prompts on the
    # text model (Cerebras when configured). If no transcript can be fetched (no
    # captions, or YouTube blocking our server's IP), Gemini watches the video from
    # its URL and its transcription goes through the same text prompts.

    MAX_TRANSCRIPT_CHARS = int(os.getenv("YOUTUBE_TRANSCRIPT_MAX_CHARS", "100000"))

    YOUTUBE_WATCH_PROMPT = (
        "Watch this video and write out its content in order: transcribe what is said, and "
        "briefly describe anything important that is only shown on screen (slides, diagrams, "
        "equations, demonstrations). Plain text only, no commentary."
    )

    def _from_youtube(self, url: str, what: str, from_text, transcript_result=None) -> Dict[str, Any]:
        """
        Get the video's text (transcript, else Gemini watching the URL) and return
        ``{"success": True, **from_text(text)}``, or a readable error.
        ``transcript_result`` skips the transcript fetch when the caller already tried it.
        """
        transcript, transcript_error = transcript_result or get_youtube_transcript(url)
        source = "transcript"
        if not transcript:
            logger.info("No YouTube transcript for %s (%s); asking Gemini to watch it", url, transcript_error)
            transcript, reader_error = self._gemini_watch_video(url)
            source = "gemini_video"
            if not transcript:
                return {
                    "success": False,
                    "error": (
                        f"Couldn't read this YouTube video. {transcript_error} The backup video "
                        f"reader also failed ({reader_error}). Try pasting the video's transcript "
                        "as text, or upload the video or audio file instead."
                    ),
                }

        transcript = transcript[: self.MAX_TRANSCRIPT_CHARS]
        try:
            result = {"success": True, **from_text(transcript), "source": source}
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Failed to parse {what} JSON: {str(e)}."}
        except Exception as e:
            return {"success": False, "error": f"Error generating {what} from the video: {str(e)}"}
        if source == "transcript":
            result["transcript"] = transcript
        return result

    def _gemini_watch_video(self, url: str) -> tuple[str | None, str | None]:
        """Gemini reads the YouTube URL as a video (file_data part). Returns (text, error)."""
        if self.gemini_service is None:
            return None, "no video reader is configured"
        message = [
            SystemMessage(content=TRANSCRIBER_SYSTEM_MESSAGE),
            HumanMessage(content=[
                {"type": "text", "text": self.YOUTUBE_WATCH_PROMPT},
                {"type": "media", "file_uri": url, "mime_type": "video/mp4"},
            ]),
        ]
        try:
            text = (self.gemini_service.llm.invoke(message).content or "").strip()
        except Exception as e:
            logger.warning("Gemini could not watch %s: %s", url, str(e)[:300])
            return None, self._short_provider_error(e)
        return (text, None) if text else (None, "it returned nothing")

    @staticmethod
    def _short_provider_error(e: Exception) -> str:
        msg = str(e)
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower():
            return "it is over its usage limit"
        if "503" in msg or "UNAVAILABLE" in msg or "overloaded" in msg.lower():
            return "it is overloaded right now"
        return msg[:150]

    def _summary_from_text(self, text: str) -> Dict[str, Any]:
        summary = self.text_service.run_prompt(
            SUMMARIZER_SYSTEM_MESSAGE, STRUCTURED_SUMMARY_FORMAT.format(content=text)).strip()
        if not summary:
            raise ValueError("Empty summary returned from model.")
        return {"summary": summary}

    def summarize_from_url(self, url: str) -> Dict[str, Any]:
        """Summarize a YouTube video (transcript, else Gemini watching it; text on the text model)."""
        return self._from_youtube(url, "summary", self._summary_from_text)

    def summarize_from_url_with_gemini(self, url: str, transcript_error: str) -> Dict[str, Any]:
        """For callers that already failed to fetch the transcript: Gemini watches the video."""
        return self._from_youtube(url, "summary", self._summary_from_text,
                                  transcript_result=(None, transcript_error))

    def mindmap_from_url(self, url: str) -> Dict[str, Any]:
        """Mindmap for a YouTube video."""
        def from_text(text: str) -> Dict[str, Any]:
            raw = self.text_service.run_prompt(MINDMAP_GENERATION_PROMPT, text)
            return {"mindmap": self._mindmap_from_json(raw)}
        return self._from_youtube(url, "mindmap", from_text)

    def flashcards_from_url(self, url: str) -> Dict[str, Any]:
        """Flashcards for a YouTube video."""
        def from_text(text: str) -> Dict[str, Any]:
            raw = self.text_service.run_prompt(FLASHCARD_GENERATION_PROMPT, text)
            cards = json.loads(self._clean_json_response(raw))
            if not isinstance(cards, list):
                raise ValueError("Model did not return a JSON array for flashcards.")
            return {"flashcards": cards, "total_cards": len(cards)}
        return self._from_youtube(url, "flashcards", from_text)

    def mcq_from_url(self, url: str, num_questions: int = 10) -> Dict[str, Any]:
        """MCQ quiz for a YouTube video."""
        def from_text(text: str) -> Dict[str, Any]:
            prompt = f"{get_mcq_quiz_prompt(num_questions)}\n\nContent:\n{text}"
            return {"quiz": self._invoke_mcq(prompt, num_questions)}
        return self._from_youtube(url, "MCQ quiz", from_text)

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
            
            return {
                "success": True,
                "mindmap": self._mindmap_from_json(mindmap_json),
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

    def _mindmap_from_json(self, raw: str) -> MindmapNode:
        """Parse a mindmap, tolerating leaf nodes given as plain strings ("Detail" for {"name": "Detail"})."""
        def node(value):
            if isinstance(value, str):
                return {"name": value}
            if isinstance(value, dict):
                value = dict(value)
                value.setdefault("name", value.pop("title", None) or value.pop("label", None) or "")
                if value.get("children") is not None:
                    value["children"] = [node(c) for c in value["children"]]
            return value
        return MindmapNode(**node(json.loads(self._clean_json_response(raw))))

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