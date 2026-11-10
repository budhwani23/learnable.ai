"""
Media processing utilities for audio and video transcription and summarization.
"""
import os
import io
import tempfile
import base64
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Tuple, Optional
from ninja.files import UploadedFile
from langchain_core.messages import SystemMessage, HumanMessage
from core import cerebras
from core.gemini import GeminiService
from constants import (
    ALLOWED_AUDIO_EXTENSIONS, ALLOWED_VIDEO_EXTENSIONS, ALLOWED_DOCUMENT_EXTENSIONS,
    TRANSCRIBER_SYSTEM_MESSAGE, SUMMARIZER_SYSTEM_MESSAGE,
    STRUCTURED_SUMMARY_FORMAT, AUDIO_TRANSCRIPTION_PROMPT, VIDEO_TRANSCRIPTION_PROMPT
)
import PyPDF2
import docx

logger = logging.getLogger(__name__)


class MediaProcessor:
    """Handles media file processing including transcription and summarization."""
    
    def __init__(self, gemini_service: GeminiService, text_service: GeminiService | None = None):
        # Gemini reads audio and video (and image-only PDFs when Cerebras is not
        # configured); text and scanned PDF pages go to Cerebras when it is.
        self.gemini_service = gemini_service
        self.text_service = text_service or gemini_service
    
    def validate_audio_file(self, audio_file: UploadedFile) -> Tuple[bool, str]:
        """Validate audio file format."""
        file_extension = os.path.splitext(audio_file.name)[1].lower()
        if file_extension not in ALLOWED_AUDIO_EXTENSIONS:
            return False, f"Unsupported audio format. Allowed: {', '.join(ALLOWED_AUDIO_EXTENSIONS)}"
        return True, file_extension
    
    def validate_video_file(self, video_file: UploadedFile) -> Tuple[bool, str]:
        """Validate video file format."""
        file_extension = os.path.splitext(video_file.name)[1].lower()
        if file_extension not in ALLOWED_VIDEO_EXTENSIONS:
            return False, f"Unsupported video format. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}"
        return True, file_extension
    
    def validate_document_file(self, document_file: UploadedFile) -> Tuple[bool, str]:
        """Validate document file format (PDF, Word)."""
        file_extension = os.path.splitext(document_file.name)[1].lower()
        if file_extension not in ALLOWED_DOCUMENT_EXTENSIONS:
            return False, f"Unsupported document format. Allowed: {', '.join(ALLOWED_DOCUMENT_EXTENSIONS)}"
        return True, file_extension

    def _save_uploaded_file(self, uploaded_file: UploadedFile, suffix: str) -> str:
        """Save uploaded file to temporary location and return file path."""
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                # Read file in chunks to handle large files better
                chunk_size = 8192  # 8KB chunks
                for chunk in uploaded_file.chunks(chunk_size=chunk_size):
                    temp_file.write(chunk)
                temp_file.flush()  # Ensure all data is written
                return temp_file.name
        except Exception as e:
            raise Exception(f"Failed to save uploaded file: {str(e)}")
    
    def _encode_file_to_base64(self, file_path: str) -> str:
        """Encode file to base64 string."""
        try:
            with open(file_path, 'rb') as f:
                file_data = f.read()
                return base64.b64encode(file_data).decode('utf-8')
        except Exception as e:
            raise Exception(f"Failed to encode file to base64: {str(e)}")
    
    def _create_transcription_message(self, base64_data: str, mime_type: str, prompt: str) -> list:
        """Create transcription message for Gemini."""
        return [
            SystemMessage(content=TRANSCRIBER_SYSTEM_MESSAGE),
            HumanMessage(content=[
                {"type": "text", "text": prompt},
                {
                    "type": "media",
                    "data": base64_data,
                    "mime_type": mime_type
                }
            ])
        ]
    
    def _create_summary_message(self, transcription: str) -> list:
        """Create summary message for Gemini."""
        return [
            SystemMessage(content=SUMMARIZER_SYSTEM_MESSAGE),
            HumanMessage(content=STRUCTURED_SUMMARY_FORMAT.format(content=transcription))
        ]
    
    def process_audio_file(self, audio_file: UploadedFile) -> Tuple[str, Optional[str]]:
        """
        Process audio file: transcribe and then summarize.
        
        Returns:
            Tuple of (summary, error_message)
        """
        # Validate file
        is_valid, file_extension = self.validate_audio_file(audio_file)
        if not is_valid:
            return None, file_extension
        
        # Save file temporarily
        temp_file_path = self._save_uploaded_file(audio_file, file_extension)
        
        try:
            # Encode to base64
            audio_base64 = self._encode_file_to_base64(temp_file_path)
            
            # Step 1: Transcribe
            transcription_message = self._create_transcription_message(
                audio_base64, f"audio/{file_extension[1:]}", AUDIO_TRANSCRIPTION_PROMPT
            )
            transcription = self.gemini_service.llm.invoke(transcription_message).content
            
            # Step 2: Summarize
            summary_message = self._create_summary_message(transcription)
            summary = self.text_service.llm.invoke(summary_message).content
            
            return summary, None
            
        except Exception as e:
            return None, f"Error processing audio file: {str(e)}"
        finally:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    def process_video_file(self, video_file: UploadedFile) -> Tuple[str, Optional[str]]:
        """
        Process video file: transcribe and then summarize.
        
        Returns:
            Tuple of (summary, error_message)
        """
        temp_file_path = None
        try:
            logger.info(f"Starting video processing: {video_file.name}, size: {video_file.size}")
            
            # Validate file
            is_valid, file_extension = self.validate_video_file(video_file)
            if not is_valid:
                logger.error(f"Video file validation failed: {file_extension}")
                return None, file_extension
            
            # Check file size (limit to 50MB for video files)
            if video_file.size > 50 * 1024 * 1024:  # 50MB
                logger.error(f"Video file size exceeds limit: {video_file.size} bytes")
                return None, "Video file size exceeds 50MB limit"
            
            # Save file temporarily
            logger.info("Saving video file to temporary location...")
            temp_file_path = self._save_uploaded_file(video_file, file_extension)
            logger.info(f"Video file saved to: {temp_file_path}")
            
            # Encode to base64
            logger.info("Encoding video file to base64...")
            video_base64 = self._encode_file_to_base64(temp_file_path)
            logger.info(f"Video file encoded, base64 length: {len(video_base64)}")
            
            # Step 1: Transcribe
            logger.info("Starting video transcription...")
            transcription_message = self._create_transcription_message(
                video_base64, f"video/{file_extension[1:]}", VIDEO_TRANSCRIPTION_PROMPT
            )
            transcription = self.gemini_service.llm.invoke(transcription_message).content
            logger.info(f"Video transcription completed, length: {len(transcription)}")
            
            # Step 2: Summarize
            logger.info("Starting video summarization...")
            summary_message = self._create_summary_message(transcription)
            summary = self.text_service.llm.invoke(summary_message).content
            logger.info(f"Video summarization completed, length: {len(summary)}")
            
            return summary, None
            
        except Exception as e:
            logger.error(f"Error processing video file: {str(e)}", exc_info=True)
            return None, f"Error processing video file: {str(e)}"
        finally:
            # Clean up temporary file
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.unlink(temp_file_path)
                    logger.info(f"Temporary file cleaned up: {temp_file_path}")
                except Exception as e:
                    logger.warning(f"Failed to clean up temporary file {temp_file_path}: {e}")
                    pass  # Ignore cleanup errors
    
    def process_document_file(self, document_file: UploadedFile) -> Tuple[str, Optional[str]]:
        """
        Process document file: extract text and summarize.
        Returns: Tuple of (summary, error_message)
        """
        is_valid, file_extension = self.validate_document_file(document_file)
        if not is_valid:
            return None, file_extension
        temp_file_path = self._save_uploaded_file(document_file, file_extension)
        try:
            text = self._extract_text_from_document(temp_file_path, file_extension)
            if not text or not text.strip():
                return None, "Could not find any readable text in this document."
            summary_message = self._create_summary_message(text)
            summary = self.text_service.llm.invoke(summary_message).content
            return summary, None
        except Exception as e:
            return None, f"Error processing document file: {str(e)}"
        finally:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)

    # Gemini's inline request limit is ~20MB; base64 inflates by ~4/3.
    MAX_INLINE_PDF_BYTES = 14 * 1024 * 1024
    # Scanned pages read visually on Cerebras (qwen): cap the work per upload.
    MAX_SCANNED_PDF_PAGES = int(os.getenv("PDF_VISION_MAX_PAGES", "40"))
    PDF_VISION_BATCH = int(os.getenv("PDF_VISION_BATCH", "4"))           # pages per request
    PDF_VISION_WORKERS = int(os.getenv("PDF_VISION_WORKERS", "3"))       # parallel requests
    PDF_RENDER_MAX_SIDE = int(os.getenv("PDF_RENDER_MAX_SIDE", "1600"))  # px, longest side
    # A page with less text than this is treated as an image (scan, slide, figure).
    MIN_PAGE_TEXT_CHARS = 25

    PDF_VISION_PROMPT = (
        "These images are pages {pages} of a document that has no text layer (scanned pages "
        "or slides saved as images). Read every page in order and transcribe all visible text "
        "faithfully. For diagrams, charts, tables and figures, add a short factual description "
        "of what they show. Output plain text only, with a '--- Page N ---' line before each "
        "page, using the page numbers given above."
    )

    def _extract_text_from_document(self, file_path: str, file_extension: str) -> str:
        """Extract text from PDF or Word document."""
        if file_extension == '.pdf':
            return self._extract_pdf_text(file_path)
        elif file_extension in ['.docx', '.doc']:
            doc = docx.Document(file_path)
            text = "\n".join([para.text for para in doc.paragraphs])
            return text
        return ""

    def _extract_pdf_text(self, file_path: str) -> str:
        """
        Text from a PDF: the text layer where there is one, and the pages without
        one (scans, slides exported as images) read visually by the vision model.
        """
        pages = self._pdf_text_layer(file_path)
        image_pages = [i for i, t in enumerate(pages) if len(t.strip()) < self.MIN_PAGE_TEXT_CHARS]
        if not image_pages:
            return "\n".join(pages)

        has_text = len(image_pages) < len(pages)
        if not cerebras.is_configured():
            if has_text:
                return "\n".join(pages)
            # No Cerebras key: Gemini reads the whole PDF natively.
            return self._read_pdf_with_gemini(file_path)

        if len(image_pages) > self.MAX_SCANNED_PDF_PAGES:
            if has_text:
                raise Exception(
                    f"This PDF has {len(image_pages)} scanned/image-only pages that need visual reading; "
                    f"we can read up to {self.MAX_SCANNED_PDF_PAGES} scanned pages at a time. "
                    "Split it into smaller PDFs or use one with selectable text."
                )
            raise Exception(
                f"This PDF has no selectable text (it looks scanned or image-based) and has "
                f"{len(image_pages)} pages; we can read up to {self.MAX_SCANNED_PDF_PAGES} scanned "
                "pages at a time. Split it into smaller PDFs or use one with selectable text."
            )

        transcribed = self._read_pdf_pages_with_vision(file_path, image_pages)
        out = []
        for i, text in enumerate(pages):
            if i in transcribed:
                out.append(transcribed[i])
            elif i not in image_pages:
                out.append(text)
        return "\n".join(out)

    def _pdf_text_layer(self, file_path: str) -> List[str]:
        """Per-page text: PyPDF2 first, PDFium for pages PyPDF2 reads poorly."""
        try:
            with open(file_path, 'rb') as f:
                pages = [page.extract_text() or '' for page in PyPDF2.PdfReader(f).pages]
        except Exception as e:  # malformed for PyPDF2; PDFium is more forgiving
            logger.info("PyPDF2 could not read the PDF (%s); trying PDFium", e)
            pages = None

        weak = None if pages is None else [
            i for i, t in enumerate(pages) if len(t.strip()) < self.MIN_PAGE_TEXT_CHARS]
        if pages is not None and not weak:
            return pages
        try:
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument(file_path)
            try:
                if pages is None:
                    pages = [''] * len(pdf)
                    weak = list(range(len(pdf)))
                for i in weak:
                    text = pdf[i].get_textpage().get_text_range() or ''
                    if len(text.strip()) > len(pages[i].strip()):
                        pages[i] = text
            finally:
                pdf.close()
        except Exception as e:
            if pages is None:
                raise Exception(f"Could not open this PDF: {e}")
            logger.warning("PDFium text extraction failed: %s", e)
        return pages

    def _render_pdf_pages(self, pdf, indices: List[int]) -> List[bytes]:
        """Render pages to JPEG, longest side at most PDF_RENDER_MAX_SIDE px."""
        images = []
        for i in indices:
            page = pdf[i]
            width, height = page.get_size()  # PDF points (1/72 inch)
            scale = min(2.0, self.PDF_RENDER_MAX_SIDE / max(width, height, 1))
            pil = page.render(scale=scale).to_pil().convert("RGB")
            buf = io.BytesIO()
            pil.save(buf, format="JPEG", quality=85)
            images.append(buf.getvalue())
        return images

    def _read_pdf_pages_with_vision(self, file_path: str, indices: List[int]) -> Dict[int, str]:
        """
        Transcribe the given (0-based) pages with the Cerebras vision model, a few
        pages per request. Returns {first page index of each batch: transcription}.
        """
        import pypdfium2 as pdfium

        # Batches of consecutive pages, so each transcription slots back in order.
        batches: List[List[int]] = []
        for i in indices:
            if batches and batches[-1][-1] == i - 1 and len(batches[-1]) < self.PDF_VISION_BATCH:
                batches[-1].append(i)
            else:
                batches.append([i])

        pdf = pdfium.PdfDocument(file_path)
        try:
            rendered = [self._render_pdf_pages(pdf, b) for b in batches]
        finally:
            pdf.close()
        logger.info("Reading %s image-only PDF pages with Cerebras vision in %s requests",
                    len(indices), len(batches))

        def read(batch: List[int], images: List[bytes]) -> str:
            numbers = ", ".join(str(i + 1) for i in batch)
            prompt = self.PDF_VISION_PROMPT.format(pages=numbers)
            content = cerebras.text_and_images(prompt, [(img, "image/jpeg") for img in images])
            return cerebras.chat(content, system=TRANSCRIBER_SYSTEM_MESSAGE)

        results: Dict[int, str] = {}
        errors: List[str] = []
        with ThreadPoolExecutor(max_workers=max(1, self.PDF_VISION_WORKERS)) as pool:
            futures = {pool.submit(read, b, imgs): b for b, imgs in zip(batches, rendered)}
            for future in as_completed(futures):
                batch = futures[future]
                try:
                    results[batch[0]] = future.result()
                except Exception as e:
                    logger.error("Vision read of PDF pages %s failed: %s", batch, e)
                    errors.append(str(e))
                    label = f"{batch[0] + 1}-{batch[-1] + 1}" if len(batch) > 1 else str(batch[0] + 1)
                    results[batch[0]] = f"[Page(s) {label} could not be read]"
        if len(errors) == len(batches):
            raise Exception(f"Could not read the scanned pages of this PDF: {errors[0]}")
        return results

    def _read_pdf_with_gemini(self, file_path: str) -> str:
        """Transcribe an image-based PDF with Gemini's native PDF understanding."""
        size = os.path.getsize(file_path)
        if size > self.MAX_INLINE_PDF_BYTES:
            raise Exception(
                "This PDF has no selectable text (it looks scanned or image-based) and is too large "
                f"to read visually ({size // (1024 * 1024)}MB, limit {self.MAX_INLINE_PDF_BYTES // (1024 * 1024)}MB). "
                "Try a smaller PDF or one with selectable text."
            )
        logger.info("PDF has no text layer; reading it with Gemini (%s bytes)", size)
        message = self._create_transcription_message(
            self._encode_file_to_base64(file_path),
            "application/pdf",
            "This PDF has no text layer (scanned pages or slides saved as images). Read every page "
            "in order and transcribe all visible text faithfully. For diagrams, charts, tables and "
            "figures, add a short factual description of what they show. Output plain text only, "
            "with a '--- Page N ---' line before each page.",
        )
        return self.gemini_service.llm.invoke(message).content or ""

    def summarize_text(self, text: str) -> Tuple[str, Optional[str]]:
        """
        Summarize text content.
        
        Returns:
            Tuple of (summary, error_message)
        """
        try:
            from langchain_core.messages import SystemMessage, HumanMessage
            input_message = [
                SystemMessage(content="You are a professional summarizer who creates concise, well-structured summaries. Focus on extracting key insights and main points."),
                HumanMessage(content=text)
            ]
            summary = self.text_service.llm.invoke(input_message).content
            return summary, None
        except Exception as e:
            return None, f"Error summarizing text: {str(e)}" 
    
    def extract_content_from_media(self, audio_file=None, video_file=None, document_file=None) -> Tuple[str, Optional[str]]:
        """
        Extract content from audio, video, or document file for use in learning services.
        Returns: Tuple of (content, error_message)
        """
        if audio_file:
            return self._extract_content_from_audio(audio_file)
        elif video_file:
            return self._extract_content_from_video(video_file)
        elif document_file:
            return self._extract_content_from_document(document_file)
        else:
            return None, "No audio, video, or document file provided"
    
    def _extract_content_from_audio(self, audio_file) -> Tuple[str, Optional[str]]:
        """Extract content from audio file."""
        # Validate file
        is_valid, file_extension = self.validate_audio_file(audio_file)
        if not is_valid:
            return None, file_extension
        
        # Save file temporarily
        temp_file_path = self._save_uploaded_file(audio_file, file_extension)
        
        try:
            # Encode to base64
            audio_base64 = self._encode_file_to_base64(temp_file_path)
            
            # Transcribe audio
            transcription_message = self._create_transcription_message(
                audio_base64, f"audio/{file_extension[1:]}", AUDIO_TRANSCRIPTION_PROMPT
            )
            content = self.gemini_service.llm.invoke(transcription_message).content
            
            return content, None
            
        except Exception as e:
            return None, f"Error extracting content from audio file: {str(e)}"
        finally:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    def _extract_content_from_video(self, video_file) -> Tuple[str, Optional[str]]:
        """Extract content from video file."""
        temp_file_path = None
        try:
            logger.info(f"Starting video content extraction: {video_file.name}, size: {video_file.size}")
            
            # Validate file
            is_valid, file_extension = self.validate_video_file(video_file)
            if not is_valid:
                logger.error(f"Video file validation failed: {file_extension}")
                return None, file_extension
            
            # Check file size (limit to 50MB for video files)
            if video_file.size > 50 * 1024 * 1024:  # 50MB
                logger.error(f"Video file size exceeds limit: {video_file.size} bytes")
                return None, "Video file size exceeds 50MB limit"
            
            # Save file temporarily
            logger.info("Saving video file to temporary location...")
            temp_file_path = self._save_uploaded_file(video_file, file_extension)
            logger.info(f"Video file saved to: {temp_file_path}")
            
            # Encode to base64
            logger.info("Encoding video file to base64...")
            video_base64 = self._encode_file_to_base64(temp_file_path)
            logger.info(f"Video file encoded, base64 length: {len(video_base64)}")
            
            # Transcribe video
            logger.info("Starting video transcription...")
            transcription_message = self._create_transcription_message(
                video_base64, f"video/{file_extension[1:]}", VIDEO_TRANSCRIPTION_PROMPT
            )
            content = self.gemini_service.llm.invoke(transcription_message).content
            logger.info(f"Video transcription completed, length: {len(content)}")
            
            return content, None
            
        except Exception as e:
            logger.error(f"Error extracting content from video file: {str(e)}", exc_info=True)
            return None, f"Error extracting content from video file: {str(e)}"
        finally:
            # Clean up temporary file
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.unlink(temp_file_path)
                    logger.info(f"Temporary file cleaned up: {temp_file_path}")
                except Exception as e:
                    logger.warning(f"Failed to clean up temporary file {temp_file_path}: {e}")
                    pass  # Ignore cleanup errors
    
    def _extract_content_from_document(self, document_file) -> Tuple[str, Optional[str]]:
        """Extract content from document file."""
        is_valid, file_extension = self.validate_document_file(document_file)
        if not is_valid:
            return None, file_extension
        temp_file_path = self._save_uploaded_file(document_file, file_extension)
        try:
            text = self._extract_text_from_document(temp_file_path, file_extension)
            if not text or not text.strip():
                return None, "Could not find any readable text in this document."
            return text, None
        except Exception as e:
            return None, f"Error extracting content from document file: {str(e)}"
        finally:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path) 