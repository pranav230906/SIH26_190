"""Local text extraction and OCR. This service does not call a cloud API."""

import logging
import re
import shutil
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from app.constants import ExtractionMethod, ExtractionStatus
from app.core.config import get_settings
from app.services.revision_diff import extract_text

logger = logging.getLogger("secure_dms.ocr")

_TEXT_READY = 20
_SAFE_OCR_MISSING = "OCR is unavailable because the local OCR program is not installed."
_SAFE_UNSUPPORTED = "This file type cannot be indexed as text."
_SAFE_FAILED = "Text could not be extracted from this file."
_SPACE = re.compile(r"[ \t]+")
_BLANK_LINES = re.compile(r"\n{3,}")


@dataclass
class ExtractedPage:
    page_number: int
    text: str
    method: str
    status: str
    error: str | None = None


def normalize_text(value: str) -> str:
    cleaned = value.replace("\x00", " ")
    cleaned = _SPACE.sub(" ", cleaned)
    cleaned = _BLANK_LINES.sub("\n\n", cleaned)
    return cleaned.strip()


def extract_pages(filename: str, mime_type: str, content: bytes) -> list[ExtractedPage]:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension in {"txt", "md", "csv"} or mime_type.startswith("text/"):
        raw = extract_text(filename, mime_type, content) or ""
        return [_page(1, raw, ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.COMPLETED.value, None)]
    if extension == "docx" or mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        raw = extract_text(filename, mime_type, content)
        if raw is None:
            return [_page(1, "", ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.FAILED.value, _SAFE_FAILED)]
        return [_page(1, raw, ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.COMPLETED.value, None)]
    if extension == "pdf" or mime_type == "application/pdf":
        return _pdf_pages(content)
    if extension in {"png", "jpg", "jpeg"} or mime_type in {"image/png", "image/jpeg"}:
        return [_ocr_image(content, 1)]
    return [_page(1, "", ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.FAILED.value, _SAFE_UNSUPPORTED)]


def _pdf_pages(content: bytes) -> list[ExtractedPage]:
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(content))
        page_count = len(reader.pages)
    except Exception:
        logger.exception("PDF text extraction failed")
        return [_page(1, "", ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.FAILED.value, _SAFE_FAILED)]
    if page_count == 0:
        return [_page(1, "", ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.COMPLETED.value, None)]
    pages: list[ExtractedPage] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            raw = page.extract_text() or ""
        except Exception:
            logger.exception("PDF page text extraction failed")
            raw = ""
        if _letter_count(raw) >= _TEXT_READY:
            pages.append(_page(index, raw, ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.COMPLETED.value, None))
            continue
        pages.append(_ocr_pdf_page(content, index))
    return pages


def _ocr_pdf_page(content: bytes, page_number: int) -> ExtractedPage:
    if not _tesseract_ready():
        return _page(page_number, "", ExtractionMethod.OCR.value, ExtractionStatus.FAILED.value, _SAFE_OCR_MISSING)
    try:
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(content)
        try:
            rendered = document[page_number - 1].render(scale=2).to_pil()
        finally:
            document.close()
        text = _read_image(rendered)
    except Exception:
        logger.exception("Scanned PDF page OCR failed")
        return _page(page_number, "", ExtractionMethod.OCR.value, ExtractionStatus.FAILED.value, _SAFE_FAILED)
    return _page(page_number, text, ExtractionMethod.OCR.value, ExtractionStatus.COMPLETED.value, None)


def _ocr_image(content: bytes, page_number: int) -> ExtractedPage:
    if not _tesseract_ready():
        return _page(page_number, "", ExtractionMethod.OCR.value, ExtractionStatus.FAILED.value, _SAFE_OCR_MISSING)
    try:
        from PIL import Image

        image = Image.open(BytesIO(content))
        text = _read_image(image)
    except Exception:
        logger.exception("Image OCR failed")
        return _page(page_number, "", ExtractionMethod.OCR.value, ExtractionStatus.FAILED.value, _SAFE_FAILED)
    return _page(page_number, text, ExtractionMethod.OCR.value, ExtractionStatus.COMPLETED.value, None)


def _read_image(image) -> str:
    import pytesseract

    command = get_settings().tesseract_cmd.strip()
    if command:
        pytesseract.pytesseract.tesseract_cmd = command
    return pytesseract.image_to_string(image) or ""


def _tesseract_ready() -> bool:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    command = get_settings().tesseract_cmd.strip()
    if command:
        return Path(command).is_file()
    return shutil.which("tesseract") is not None


def _letter_count(value: str) -> int:
    return sum(1 for char in value if char.isalnum())


def _page(number: int, text: str, method: str, status: str, error: str | None) -> ExtractedPage:
    return ExtractedPage(
        page_number=number,
        text=normalize_text(text),
        method=method,
        status=status,
        error=error,
    )
