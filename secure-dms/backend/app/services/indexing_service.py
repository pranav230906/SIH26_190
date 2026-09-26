"""Build lexical and semantic indexes after a document is already stored.

`index_document` is synchronous for this prototype. A worker can call the same
function later without changing upload or authorization.
"""

import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.constants import ExtractionMethod, ExtractionStatus, IndexStatus
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import DerivedArtifact, Evidence
from app.models.search import DocumentIndexStatus, DocumentText, SearchChunk
from app.services.embedding_service import EmbeddingError, embed_text
from app.services.ocr_service import ExtractedPage, extract_pages
from app.services.revision_diff import extract_text
from app.services.storage_service import get_storage

logger = logging.getLogger("secure_dms.index")

CHUNK_SIZE = 400
CHUNK_OVERLAP = 50
_UPLOAD_INDEX_FAILED = "Document uploaded successfully, but search indexing is currently unavailable."
_SEMANTIC_FAILED = "Document uploaded successfully. Keyword search is ready. Semantic indexing is currently unavailable."


@dataclass
class IndexOutcome:
    lexical_status: str
    semantic_status: str
    ocr_status: str
    pages_processed: int
    total_pages: int
    extraction_method: str | None
    error_message: str | None

    @property
    def notice(self) -> str | None:
        if self.ocr_status == ExtractionStatus.FAILED.value or self.lexical_status == IndexStatus.FAILED.value:
            return _UPLOAD_INDEX_FAILED
        if self.semantic_status == IndexStatus.FAILED.value:
            return _SEMANTIC_FAILED
        return None


def index_document(db: Session, document: Document) -> IndexOutcome:
    try:
        versions = list(
            db.scalars(select(DocumentVersion).where(DocumentVersion.document_id == document.id)).all()
        )
        if not versions:
            outcome = _failed_outcome("This document has no stored version to index.")
            _write_status(db, document, None, [], outcome)
            db.commit()
            return outcome
        official = next((item for item in versions if item.is_official), None)
        focus = official or max(versions, key=lambda item: item.version_number)
        focus_pages: list[ExtractedPage] = []
        focus_lexical = IndexStatus.READY.value
        focus_semantic = IndexStatus.READY.value
        for version in versions:
            pages, lexical, semantic = _index_version(db, document, version)
            if version.id == focus.id:
                focus_pages = pages
                focus_lexical = lexical
                focus_semantic = semantic
        outcome = _outcome_from_pages(focus_pages, focus_lexical, focus_semantic)
        _write_status(db, document, focus, focus_pages, outcome)
        db.commit()
        return outcome
    except Exception:
        logger.exception("Document indexing failed")
        db.rollback()
        outcome = _failed_outcome("Search indexing is currently unavailable.")
        _write_status(db, document, None, [], outcome)
        db.commit()
        return outcome


def index_evidence_record(db: Session, evidence: Evidence) -> None:
    try:
        db.execute(
            delete(SearchChunk).where(
                SearchChunk.evidence_id == evidence.id,
                SearchChunk.artifact_id.is_(None),
            )
        )
        metadata = "\n".join(
            part
            for part in (
                evidence.evidence_number,
                evidence.title,
                evidence.description or "",
                evidence.evidence_type,
                evidence.status,
            )
            if part
        )
        _store_chunks(
            db,
            case_id=evidence.case_id,
            evidence_id=evidence.id,
            source_evidence_id=evidence.id,
            content_type="evidence",
            method=ExtractionMethod.TEXT_EXTRACTION.value,
            page_number=None,
            text=metadata,
        )
        if evidence.mime_type.startswith("text/"):
            extra = _file_text(evidence.storage_path, evidence.original_filename, evidence.mime_type)
            if extra:
                _store_chunks(
                    db,
                    case_id=evidence.case_id,
                    evidence_id=evidence.id,
                    source_evidence_id=evidence.id,
                    content_type="evidence",
                    method=ExtractionMethod.TEXT_EXTRACTION.value,
                    page_number=1,
                    text=extra,
                )
        db.commit()
    except Exception:
        logger.exception("Evidence indexing failed")
        db.rollback()


def index_artifact_record(db: Session, artifact: DerivedArtifact) -> None:
    try:
        db.execute(delete(SearchChunk).where(SearchChunk.artifact_id == artifact.id))
        metadata = "\n".join(
            part
            for part in (
                artifact.artifact_number,
                artifact.title,
                artifact.description or "",
                artifact.artifact_type,
                artifact.processing_description,
            )
            if part
        )
        _store_chunks(
            db,
            case_id=artifact.case_id,
            evidence_id=artifact.source_evidence_id,
            artifact_id=artifact.id,
            source_evidence_id=artifact.source_evidence_id,
            content_type="artifact",
            method=ExtractionMethod.TEXT_EXTRACTION.value,
            page_number=None,
            text=metadata,
        )
        if artifact.mime_type.startswith("text/"):
            extra = _file_text(artifact.storage_path, artifact.original_filename, artifact.mime_type)
            if extra:
                _store_chunks(
                    db,
                    case_id=artifact.case_id,
                    evidence_id=artifact.source_evidence_id,
                    artifact_id=artifact.id,
                    source_evidence_id=artifact.source_evidence_id,
                    content_type="artifact",
                    method=ExtractionMethod.TEXT_EXTRACTION.value,
                    page_number=1,
                    text=extra,
                )
        db.commit()
    except Exception:
        logger.exception("Artifact indexing failed")
        db.rollback()


def _index_version(db: Session, document: Document, version: DocumentVersion) -> tuple[list[ExtractedPage], str, str]:
    db.execute(delete(DocumentText).where(DocumentText.version_id == version.id))
    db.execute(delete(SearchChunk).where(SearchChunk.version_id == version.id))
    try:
        content = get_storage().get_file(version.storage_path).read_bytes()
        pages = extract_pages(version.original_filename, version.mime_type, content)
    except AppError:
        pages = [
            ExtractedPage(1, "", ExtractionMethod.TEXT_EXTRACTION.value, ExtractionStatus.FAILED.value, "The stored file is not available.")
        ]
    lexical = IndexStatus.READY.value
    semantic = IndexStatus.READY.value
    stored_any = False
    embedding_failed = False
    for page in pages:
        db.add(
            DocumentText(
                document_id=document.id,
                version_id=version.id,
                page_number=page.page_number,
                text=page.text,
                extraction_method=page.method,
                status=page.status,
                error_message=page.error,
            )
        )
        if page.status != ExtractionStatus.COMPLETED.value or not page.text:
            continue
        for index, piece in enumerate(_split(page.text)):
            embedded = _embed_or_none(piece)
            if embedded is None and piece:
                embedding_failed = True
            db.add(
                SearchChunk(
                    case_id=document.case_id,
                    document_id=document.id,
                    version_id=version.id,
                    page_number=page.page_number,
                    chunk_index=index,
                    content_type="document",
                    extraction_method=page.method,
                    text=piece,
                    embedding=embedded,
                )
            )
            stored_any = True
    extraction_failed = any(page.status == ExtractionStatus.FAILED.value for page in pages) and not stored_any
    if extraction_failed:
        lexical = IndexStatus.FAILED.value
        semantic = IndexStatus.FAILED.value
    elif embedding_failed:
        semantic = IndexStatus.FAILED.value
    return pages, lexical, semantic


def _store_chunks(db: Session, *, case_id, evidence_id, source_evidence_id, content_type, method, page_number, text, artifact_id=None) -> None:
    for index, piece in enumerate(_split(text)):
        db.add(
            SearchChunk(
                case_id=case_id,
                document_id=None,
                version_id=None,
                evidence_id=evidence_id,
                artifact_id=artifact_id,
                source_evidence_id=source_evidence_id,
                page_number=page_number,
                chunk_index=index,
                content_type=content_type,
                extraction_method=method,
                text=piece,
                embedding=_embed_or_none(piece),
            )
        )


def _file_text(relative_path: str, filename: str, mime_type: str) -> str:
    try:
        content = Path(get_storage().get_file(relative_path)).read_bytes()
    except Exception:
        logger.exception("Stored text file could not be read for indexing")
        return ""
    return extract_text(filename, mime_type, content) or ""


def _embed_or_none(text: str) -> list[float] | None:
    try:
        return embed_text(text)
    except EmbeddingError:
        return None
    except Exception:
        logger.exception("Embedding failed")
        return None


def _split(text: str) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    if len(cleaned) <= CHUNK_SIZE:
        return [cleaned]
    pieces: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + CHUNK_SIZE)
        pieces.append(cleaned[start:end])
        if end >= len(cleaned):
            break
        start = end - CHUNK_OVERLAP
    return pieces


def _outcome_from_pages(pages: list[ExtractedPage], lexical: str, semantic: str) -> IndexOutcome:
    failed = [page for page in pages if page.status == ExtractionStatus.FAILED.value]
    completed = [page for page in pages if page.status == ExtractionStatus.COMPLETED.value]
    methods = {page.method for page in completed}
    if ExtractionMethod.OCR.value in methods:
        method = ExtractionMethod.OCR.value
    elif methods:
        method = ExtractionMethod.TEXT_EXTRACTION.value
    else:
        method = pages[0].method if pages else None
    return IndexOutcome(
        lexical_status=lexical,
        semantic_status=semantic,
        ocr_status=ExtractionStatus.FAILED.value if failed else ExtractionStatus.COMPLETED.value,
        pages_processed=len(completed),
        total_pages=len(pages),
        extraction_method=method,
        error_message=failed[0].error if failed else None,
    )


def _failed_outcome(message: str) -> IndexOutcome:
    return IndexOutcome(
        lexical_status=IndexStatus.FAILED.value,
        semantic_status=IndexStatus.FAILED.value,
        ocr_status=ExtractionStatus.FAILED.value,
        pages_processed=0,
        total_pages=0,
        extraction_method=None,
        error_message=message,
    )


def _write_status(db: Session, document: Document, version: DocumentVersion | None, pages: list[ExtractedPage], outcome: IndexOutcome) -> None:
    row = db.scalar(select(DocumentIndexStatus).where(DocumentIndexStatus.document_id == document.id))
    if row is None:
        row = DocumentIndexStatus(document_id=document.id)
        db.add(row)
    row.version_id = version.id if version is not None else None
    row.lexical_status = outcome.lexical_status
    row.semantic_status = outcome.semantic_status
    row.ocr_status = outcome.ocr_status
    row.pages_processed = outcome.pages_processed
    row.total_pages = outcome.total_pages
    row.extraction_method = outcome.extraction_method
    row.error_message = (outcome.error_message or "")[:300] or None
    if pages and not outcome.error_message:
        row.error_message = None
