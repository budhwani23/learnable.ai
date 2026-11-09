# schema.py
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


# Text Summarization Schemas
class SummarizeTextInput(BaseModel):
    text: str = Field(..., description="Text content to be summarized", min_length=1)


class SummarizeContentInput(BaseModel):
    text: Optional[str] = Field(None, description="Text content to be summarized")
    # Note: audio_file will be handled separately as it's a file upload


class SummarizeTextOutput(BaseModel):
    success: bool
    original_text: str
    summary: str
    word_count_original: int
    word_count_summary: int
    content_type: Optional[str] = Field(None, description="Type of content processed (text/audio)")


# Mindmap Schemas
class MindmapNode(BaseModel):
    name: str = Field(..., description="Node name/label")
    children: Optional[List['MindmapNode']] = Field(default=None, description="Child nodes")


class MindmapInput(BaseModel):
    topic: str = Field(..., description="Topic to generate mindmap for", min_length=1)


class MindmapMultimediaInput(BaseModel):
    topic: Optional[str] = Field(None, description="Topic to generate mindmap for")
    # Note: audio_file, video_file, and document_file will be handled separately as file uploads


class MindmapOutput(BaseModel):
    success: bool
    topic: str
    mindmap: MindmapNode
    content_type: Optional[str] = Field(None, description="Type of content processed (text/audio/video/document)")


# MCQ Quiz Schemas - Structured Output
class MCQQuestionStructured(BaseModel):
    question: str = Field(..., description="Question text")
    option_a: str = Field(..., description="Text of the first answer choice, without any letter label")
    option_b: str = Field(..., description="Text of the second answer choice, without any letter label")
    option_c: str = Field(..., description="Text of the third answer choice, without any letter label")
    option_d: str = Field(..., description="Text of the fourth answer choice, without any letter label")
    correct_answer: str = Field(..., description="Correct answer (A, B, C, or D)")
    explanation: str = Field(..., description="Explanation for the correct answer")


class MCQQuizStructuredOutput(BaseModel):
    questions: List[MCQQuestionStructured] = Field(..., description="List of MCQ questions")


# Legacy MCQ Quiz Schemas (for JSON parsing fallback)
class MCQOption(BaseModel):
    option: str = Field(..., description="Option text (A, B, C, D)")
    text: str = Field(..., description="Option content")


class MCQQuestion(BaseModel):
    question: str = Field(..., description="Question text")
    options: List[str] = Field(..., description="List of options A, B, C, D")
    correct_answer: str = Field(..., description="Correct answer (A, B, C, or D)")
    explanation: str = Field(..., description="Explanation for the correct answer")


class MCQQuizInput(BaseModel):
    content: str = Field(..., description="Content to generate quiz from", min_length=1)
    num_questions: int = Field(default=10, ge=1, le=50, description="Number of questions to generate")


class MCQQuizMultimediaInput(BaseModel):
    content: Optional[str] = Field(None, description="Content to generate quiz from")
    num_questions: int = Field(default=10, ge=1, le=50, description="Number of questions to generate")
    # Note: audio_file, video_file, and document_file will be handled separately as file uploads


class MCQQuizOutput(BaseModel):
    success: bool
    content: str
    num_questions: int
    quiz: List[MCQQuestion]
    content_type: Optional[str] = Field(None, description="Type of content processed (text/audio/video/document)")


# Flashcard Schemas
class Flashcard(BaseModel):
    front: str = Field(..., description="Front of the flashcard (question/concept)")
    back: str = Field(..., description="Back of the flashcard (answer/explanation)")
    category: str = Field(..., description="Category of the flashcard")
    difficulty: str = Field(..., description="Difficulty level (easy/medium/hard)")


class FlashcardInput(BaseModel):
    content: str = Field(..., description="Content to generate flashcards from", min_length=1)


class FlashcardMultimediaInput(BaseModel):
    content: Optional[str] = Field(None, description="Content to generate flashcards from")
    # Note: audio_file, video_file, and document_file will be handled separately as file uploads


class FlashcardOutput(BaseModel):
    success: bool
    content: str
    flashcards: List[Flashcard]
    total_cards: int
    content_type: Optional[str] = Field(None, description="Type of content processed (text/audio/video/document)")


# Audio Transcription Schemas
class AudioTranscriptionInput(BaseModel):
    # This will be handled by file upload, but we can define metadata
    file_name: Optional[str] = Field(None, description="Name of the uploaded audio file")
    file_size: Optional[int] = Field(None, description="Size of the uploaded file in bytes")


class AudioTranscriptionOutput(BaseModel):
    success: bool
    job_id: str
    transcript: str
    file_name: str


# Error Response Schema
class ErrorResponse(BaseModel):
    error: str = Field(..., description="Error message")


# Generic Success Response
class SuccessResponse(BaseModel):
    success: bool = True
    message: str = Field(..., description="Success message")


# Query Parameter Schemas
class MCQQuizQueryParams(BaseModel):
    content: str = Field(..., description="Content to generate quiz from")
    num_questions: int = Field(default=10, ge=1, le=50, description="Number of questions")


# Update the MindmapNode to handle self-referencing
MindmapNode.model_rebuild() 