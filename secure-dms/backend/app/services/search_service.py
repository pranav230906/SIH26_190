"""Authorized search. Filters are applied before lexical or vector ranking."""

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timezone

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.authorization.permission_service import authorize, effective_permission_codes, role_has_system_case_access
from app.constants import (
    Action,
    CaseEventType,
    DocumentVersionStatus,
    ExtractionStatus,
    IndexStatus,
    MatchType,
    ResourceType,
    RoleName,
    SearchMode,
)
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.models.access_request import AccessRequest
from app.models.case import Case
from app.models.case_assignment import CaseAssignment
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import DerivedArtifact, Evidence
from app.models.search import DocumentIndexStatus, DocumentText, SearchChunk
from app.models.user import User
from app.schemas.search import (
    OcrStatusResponse,
    PageTextResponse,
    SearchResponse,
    SearchResult,
    SearchSuggestResponse,
    SearchSuggestion,
)
from app.services.case_timeline import add_event
from app.services.embedding_service import EmbeddingError, cosine, embed_text
from app.services.indexing_service import index_document

logger = logging.getLogger("secure_dms.search")

_SEMANTIC_FLOOR = 0.7
_LIMIT = 20
_CANDIDATES = 40
_HISTORICAL = (DocumentVersionStatus.APPROVED.value, DocumentVersionStatus.SUPERSEDED.value)
_DRAFTS = (
    DocumentVersionStatus.DRAFT.value,
    DocumentVersionStatus.REJECTED.value,
    DocumentVersionStatus.SUBMITTED_FOR_REVIEW.value,
)


@dataclass
class _Hit:
    key: tuple
    result: SearchResult
    lexical: float = 0.0
    semantic: float = 0.0
    exact: bool = False
    kind: str = MatchType.LEXICAL.value


def search(
    db: Session,
    user: User,
    *,
    query: str,
    mode: str,
    case_id: uuid.UUID | None = None,
    document_type: str | None = None,
    department_id: uuid.UUID | None = None,
    file_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    match_type: str | None = None,
    include_previous: bool = False,
    include_evidence: bool = True,
    include_ocr: bool = True,
    record_audit: bool = True,
) -> SearchResponse:
    cleaned = " ".join(query.split())
    if not cleaned:
        raise AppError(422, "validation_error", "Enter a search term.")
    if mode not in {item.value for item in SearchMode}:
        raise AppError(422, "validation_error", "That search mode is not available.")
    if match_type is not None and match_type not in {item.value for item in MatchType}:
        raise AppError(422, "validation_error", "That match type is not available.")
    codes = set(effective_permission_codes(user))
    case_ids = _accessible_case_ids(db, user, codes)
    if case_id is not None:
        case_ids = [case_id] if case_id in set(case_ids) else []
    if not case_ids:
        if record_audit:
            _audit_search(db, user, mode, [])
        return SearchResponse(results=[], total=0, mode=mode, semantic_available=_semantic_ready(cleaned, mode), message=None)

    vector = _query_vector(cleaned, mode)
    semantic_available = vector is not None
    hits: dict[tuple, _Hit] = {}
    if mode in {SearchMode.LEXICAL.value, SearchMode.HYBRID.value}:
        if "DOCUMENT.READ" in codes:
            _lexical_documents(
                db, user, hits, cleaned, case_ids, codes, document_type, department_id, file_type, date_from, date_to, include_previous, include_ocr
            )
        if include_evidence and document_type is None and "EVIDENCE.READ" in codes:
            _lexical_evidence(db, user, hits, cleaned, case_ids, department_id, file_type, date_from, date_to, include_ocr, artifact=False)
        if include_evidence and document_type is None and "DERIVED_ARTIFACT.READ" in codes:
            _lexical_evidence(db, user, hits, cleaned, case_ids, department_id, file_type, date_from, date_to, include_ocr, artifact=True)
    if mode in {SearchMode.SEMANTIC.value, SearchMode.HYBRID.value} and vector is not None:
        if "DOCUMENT.READ" in codes:
            _semantic_documents(
                db, user, hits, cleaned, vector, case_ids, codes, document_type, department_id, file_type, date_from, date_to, include_previous, include_ocr
            )
        if include_evidence and document_type is None and "EVIDENCE.READ" in codes:
            _semantic_evidence(db, user, hits, cleaned, vector, case_ids, department_id, file_type, date_from, date_to, include_ocr, artifact=False)
        if include_evidence and document_type is None and "DERIVED_ARTIFACT.READ" in codes:
            _semantic_evidence(db, user, hits, cleaned, vector, case_ids, department_id, file_type, date_from, date_to, include_ocr, artifact=True)
    if mode in {SearchMode.LEXICAL.value, SearchMode.HYBRID.value}:
        if "DOCUMENT.READ" in codes:
            _metadata_documents(db, user, hits, cleaned, case_ids, document_type, department_id, file_type, date_from, date_to)
        if include_evidence and document_type is None and "EVIDENCE.READ" in codes:
            _metadata_evidence(db, user, hits, cleaned, case_ids, department_id, file_type, date_from, date_to)

    ranked = _rank(hits, match_type)
    message = None
    if mode != SearchMode.LEXICAL.value and not semantic_available:
        message = "Semantic ranking is unavailable."
    if record_audit:
        _audit_search(db, user, mode, ranked[:_LIMIT])
    return SearchResponse(
        results=[item.result for item in ranked[:_LIMIT]],
        total=len(ranked),
        mode=mode,
        semantic_available=semantic_available,
        message=message,
    )


def suggest(db: Session, user: User, query: str) -> SearchSuggestResponse:
    cleaned = " ".join(query.split())
    if len(cleaned) < 2:
        return SearchSuggestResponse(suggestions=[])
    codes = set(effective_permission_codes(user))
    case_ids = _accessible_case_ids(db, user, codes)
    if not case_ids:
        return SearchSuggestResponse(suggestions=[])
    prefix = _like_prefix(cleaned)
    contains = _like_contains(cleaned)
    suggestions: list[SearchSuggestion] = []
    if "CASE.READ" in codes:
        cases = db.execute(
            select(Case).where(Case.id.in_(case_ids), Case.case_number.ilike(prefix, escape="\\")).limit(4)
        ).scalars()
        for case in cases:
            suggestions.append(SearchSuggestion(label=case.case_number, kind="case", href=f"/cases/{case.id}"))
    if "DOCUMENT.READ" in codes:
        from app.services.document_service import _readable_clause

        rows = db.execute(
            select(Document, Case)
            .join(Case, Case.id == Document.case_id)
            .where(
                Document.case_id.in_(case_ids),
                _readable_clause(user),
                or_(Document.document_number.ilike(prefix, escape="\\"), Document.title.ilike(contains, escape="\\")),
            )
            .limit(6)
        ).all()
        for document, case in rows:
            if not authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=case).allowed:
                continue
            suggestions.append(
                SearchSuggestion(
                    label=f"{document.document_number} · {document.title}",
                    kind="document",
                    href=f"/documents/{document.id}",
                )
            )
    if "EVIDENCE.READ" in codes:
        from app.services.evidence_service import _readable_clause as evidence_clause

        rows = db.execute(
            select(Evidence, Case)
            .join(Case, Case.id == Evidence.case_id)
            .where(
                Evidence.case_id.in_(case_ids),
                evidence_clause(user, Evidence.classification, Evidence.id, ResourceType.EVIDENCE),
                or_(Evidence.evidence_number.ilike(prefix, escape="\\"), Evidence.title.ilike(contains, escape="\\")),
            )
            .limit(4)
        ).all()
        for evidence, case in rows:
            if not authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=case).allowed:
                continue
            suggestions.append(
                SearchSuggestion(label=f"{evidence.evidence_number} · {evidence.title}", kind="evidence", href=f"/evidence/{evidence.id}")
            )
    return SearchSuggestResponse(suggestions=suggestions[:8])


def record_result_opened(
    db: Session,
    user: User,
    *,
    document_id: uuid.UUID | None,
    evidence_id: uuid.UUID | None,
    artifact_id: uuid.UUID | None,
) -> None:
    if document_id is None and evidence_id is None and artifact_id is None:
        raise AppError(422, "validation_error", "A search result is required.")
    events: list[tuple[uuid.UUID, str]] = []
    if document_id is not None:
        from app.services.document_service import _load, _require_visible

        document = _load(db, document_id)
        _require_visible(user, document)
        events.append((document.case_id, f"Search result opened for {document.document_number}."))
    if artifact_id is not None:
        from app.services.evidence_service import _load_artifact, _require_artifact_visible

        artifact = _load_artifact(db, artifact_id)
        _require_artifact_visible(user, artifact)
        events.append((artifact.case_id, f"Search result opened for {artifact.artifact_number}."))
    elif evidence_id is not None:
        from app.services.evidence_service import _load_evidence, _require_visible

        evidence = _load_evidence(db, evidence_id)
        _require_visible(user, evidence)
        events.append((evidence.case_id, f"Search result opened for {evidence.evidence_number}."))
    for case_id, message in events:
        add_event(
            db,
            case_id=case_id,
            event_type=CaseEventType.DOCUMENT_SEARCH_RESULT_OPENED,
            message=message,
            actor_id=user.id,
        )
    db.commit()


def get_ocr_status(db: Session, user: User, document_id: uuid.UUID) -> OcrStatusResponse:
    document = _visible_document(db, user, document_id)
    row = db.scalar(select(DocumentIndexStatus).where(DocumentIndexStatus.document_id == document.id))
    if row is None:
        return OcrStatusResponse(
            status=ExtractionStatus.PENDING.value,
            pages_processed=0,
            total_pages=0,
            lexical_status=IndexStatus.PENDING.value,
            semantic_status=IndexStatus.PENDING.value,
            ocr_status=ExtractionStatus.PENDING.value,
        )
    return OcrStatusResponse(
        status=row.ocr_status,
        pages_processed=row.pages_processed,
        total_pages=row.total_pages,
        extraction_method=row.extraction_method,
        error=row.error_message,
        lexical_status=row.lexical_status,
        semantic_status=row.semantic_status,
        ocr_status=row.ocr_status,
    )


def reindex_document(db: Session, user: User, document_id: uuid.UUID) -> OcrStatusResponse:
    document = _visible_document(db, user, document_id)
    from app.services.audit_service import record

    record("OCR_STARTED", user_id=user.id, case_id=document.case_id, document_id=document.id)
    index_document(db, document)
    record("OCR_COMPLETED", user_id=user.id, case_id=document.case_id, document_id=document.id)
    return get_ocr_status(db, user, document.id)


def get_page_text(db: Session, user: User, document_id: uuid.UUID, page_number: int, version_id: uuid.UUID | None) -> PageTextResponse:
    document = _visible_document(db, user, document_id)
    codes = set(effective_permission_codes(user))
    version = _selected_version(db, user, document, version_id, codes)
    row = db.scalar(
        select(DocumentText).where(
            DocumentText.version_id == version.id,
            DocumentText.page_number == page_number,
        )
    )
    if row is None or row.status != ExtractionStatus.COMPLETED.value:
        raise AppError(404, "not_found", "That page is not available.")
    return PageTextResponse(
        document_id=document.id,
        version_id=version.id,
        version_label=version.version_label,
        page_number=row.page_number,
        text=row.text,
        extraction_method=row.extraction_method,
        status=row.status,
    )


def _lexical_documents(db, user, hits, query, case_ids, codes, document_type, department_id, file_type, date_from, date_to, include_previous, include_ocr) -> None:
    from app.services.document_service import _readable_clause

    rank = func.ts_rank(SearchChunk.search_vector, func.plainto_tsquery("simple", query))
    statement = (
        select(SearchChunk, Document, DocumentVersion, Case, rank.label("rank"))
        .join(Document, Document.id == SearchChunk.document_id)
        .join(DocumentVersion, DocumentVersion.id == SearchChunk.version_id)
        .join(Case, Case.id == SearchChunk.case_id)
        .where(
            SearchChunk.case_id.in_(case_ids),
            SearchChunk.content_type == "document",
            _readable_clause(user),
            _version_clause(user, include_previous, codes),
            or_(SearchChunk.search_vector.op("@@")(func.plainto_tsquery("simple", query)), SearchChunk.text.ilike(_like_contains(query), escape="\\")),
            *_shared_filters(document_type, department_id, file_type, date_from, date_to, include_ocr, Document, Case),
        )
        .order_by(rank.desc())
        .limit(_CANDIDATES)
    )
    try:
        rows = db.execute(statement).all()
    except Exception:
        logger.exception("Lexical document search failed")
        db.rollback()
        return
    for chunk, document, version, case, raw_rank in rows:
        if not authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=case).allowed:
            continue
        _add_lexical(hits, _document_hit(chunk, document, version, case, query), _lexical_score(raw_rank, chunk.text, query), _is_exact(chunk.text, document, case, query))


def _semantic_documents(db, user, hits, query, vector, case_ids, codes, document_type, department_id, file_type, date_from, date_to, include_previous, include_ocr) -> None:
    from app.services.document_service import _readable_clause

    rows = db.execute(
        select(SearchChunk, Document, DocumentVersion, Case)
        .join(Document, Document.id == SearchChunk.document_id)
        .join(DocumentVersion, DocumentVersion.id == SearchChunk.version_id)
        .join(Case, Case.id == SearchChunk.case_id)
        .where(
            SearchChunk.case_id.in_(case_ids),
            SearchChunk.content_type == "document",
            SearchChunk.embedding.is_not(None),
            _readable_clause(user),
            _version_clause(user, include_previous, codes),
            *_shared_filters(document_type, department_id, file_type, date_from, date_to, include_ocr, Document, Case),
        )
    ).all()
    scored: list[tuple[float, object]] = []
    for row in rows:
        chunk = row[0]
        score = cosine(vector, list(chunk.embedding or []))
        if score < _SEMANTIC_FLOOR:
            continue
        scored.append((score, row))
    scored.sort(key=lambda item: item[0], reverse=True)
    for score, row in scored[:_CANDIDATES]:
        chunk, document, version, case = row
        if not authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=case).allowed:
            continue
        _add_semantic(hits, _document_hit(chunk, document, version, case, query), score)


def _lexical_evidence(db, user, hits, query, case_ids, department_id, file_type, date_from, date_to, include_ocr, artifact: bool) -> None:
    from app.services.evidence_service import _readable_clause as evidence_clause

    model = DerivedArtifact if artifact else Evidence
    resource = ResourceType.DERIVED_ARTIFACT if artifact else ResourceType.EVIDENCE
    content_type = "artifact" if artifact else "evidence"
    rank = func.ts_rank(SearchChunk.search_vector, func.plainto_tsquery("simple", query))
    joined_id = SearchChunk.artifact_id if artifact else SearchChunk.evidence_id
    statement = (
        select(SearchChunk, model, Case, rank.label("rank"))
        .join(model, model.id == joined_id)
        .join(Case, Case.id == SearchChunk.case_id)
        .where(
            SearchChunk.case_id.in_(case_ids),
            SearchChunk.content_type == content_type,
            evidence_clause(user, model.classification, model.id, resource),
            or_(SearchChunk.search_vector.op("@@")(func.plainto_tsquery("simple", query)), SearchChunk.text.ilike(_like_contains(query), escape="\\")),
            *_evidence_filters(department_id, file_type, date_from, date_to, include_ocr, model, Case),
        )
        .order_by(rank.desc())
        .limit(_CANDIDATES)
    )
    try:
        rows = db.execute(statement).all()
    except Exception:
        logger.exception("Lexical evidence search failed")
        db.rollback()
        return
    for chunk, resource_row, case, raw_rank in rows:
        if not authorize(user, Action.READ, resource, resource=resource_row, case=case).allowed:
            continue
        hit = _evidence_hit(chunk, resource_row, case, query, artifact)
        exact = _is_exact(chunk.text, None, case, query) or _number_exact(resource_row, query)
        _add_lexical(hits, hit, _lexical_score(raw_rank, chunk.text, query), exact)


def _semantic_evidence(db, user, hits, query, vector, case_ids, department_id, file_type, date_from, date_to, include_ocr, artifact: bool) -> None:
    from app.services.evidence_service import _readable_clause as evidence_clause

    model = DerivedArtifact if artifact else Evidence
    resource = ResourceType.DERIVED_ARTIFACT if artifact else ResourceType.EVIDENCE
    content_type = "artifact" if artifact else "evidence"
    joined_id = SearchChunk.artifact_id if artifact else SearchChunk.evidence_id
    rows = db.execute(
        select(SearchChunk, model, Case)
        .join(model, model.id == joined_id)
        .join(Case, Case.id == SearchChunk.case_id)
        .where(
            SearchChunk.case_id.in_(case_ids),
            SearchChunk.content_type == content_type,
            SearchChunk.embedding.is_not(None),
            evidence_clause(user, model.classification, model.id, resource),
            *_evidence_filters(department_id, file_type, date_from, date_to, include_ocr, model, Case),
        )
    ).all()
    scored = []
    for row in rows:
        score = cosine(vector, list(row[0].embedding or []))
        if score >= _SEMANTIC_FLOOR:
            scored.append((score, row))
    scored.sort(key=lambda item: item[0], reverse=True)
    for score, row in scored[:_CANDIDATES]:
        chunk, resource_row, case = row
        if not authorize(user, Action.READ, resource, resource=resource_row, case=case).allowed:
            continue
        _add_semantic(hits, _evidence_hit(chunk, resource_row, case, query, artifact), score)


def _metadata_documents(db, user, hits, query, case_ids, document_type, department_id, file_type, date_from, date_to) -> None:
    from app.services.document_service import _readable_clause

    needle = _like_contains(query)
    rows = db.execute(
        select(Document, Case, User)
        .join(Case, Case.id == Document.case_id)
        .join(User, User.id == Document.created_by)
        .where(
            Document.case_id.in_(case_ids),
            _readable_clause(user),
            or_(
                Document.document_number.ilike(needle, escape="\\"),
                Document.title.ilike(needle, escape="\\"),
                Document.description.ilike(needle, escape="\\"),
                Document.document_type.ilike(needle, escape="\\"),
                Document.status.ilike(needle, escape="\\"),
                Case.case_number.ilike(needle, escape="\\"),
                User.full_name.ilike(needle, escape="\\"),
            ),
            *_shared_filters(document_type, department_id, file_type, date_from, date_to, True, Document, Case),
        )
        .limit(_CANDIDATES)
    ).all()
    known = {key[1] for key in hits if key and key[0] == "document"}
    for document, case, creator in rows:
        if document.id in known:
            continue
        if not authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=case).allowed:
            continue
        exact = query.lower() in {document.document_number.lower(), case.case_number.lower()}
        snippet_source = " ".join(part for part in (document.document_number, document.title, document.description or "", creator.full_name) if part)
        result = SearchResult(
            type="document",
            case_id=case.id,
            case_number=case.case_number,
            document_id=document.id,
            document_number=document.document_number,
            title=document.title,
            snippet=_snippet(snippet_source, query),
            score=1.0 if exact else 0.7,
            match_type=MatchType.METADATA.value,
        )
        hits[("meta", document.id)] = _Hit(key=("meta", document.id), result=result, lexical=result.score, exact=exact, kind=MatchType.METADATA.value)


def _metadata_evidence(db, user, hits, query, case_ids, department_id, file_type, date_from, date_to) -> None:
    from app.services.evidence_service import _readable_clause as evidence_clause

    needle = _like_contains(query)
    rows = db.execute(
        select(Evidence, Case)
        .join(Case, Case.id == Evidence.case_id)
        .where(
            Evidence.case_id.in_(case_ids),
            evidence_clause(user, Evidence.classification, Evidence.id, ResourceType.EVIDENCE),
            or_(
                Evidence.evidence_number.ilike(needle, escape="\\"),
                Evidence.title.ilike(needle, escape="\\"),
                Evidence.description.ilike(needle, escape="\\"),
                Evidence.evidence_type.ilike(needle, escape="\\"),
                Evidence.status.ilike(needle, escape="\\"),
                Case.case_number.ilike(needle, escape="\\"),
            ),
            *_evidence_filters(department_id, file_type, date_from, date_to, True, Evidence, Case),
        )
        .limit(_CANDIDATES)
    ).all()
    known = {key[1] for key in hits if key and key[0] == "evidence"}
    for evidence, case in rows:
        if evidence.id in known:
            continue
        if not authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=case).allowed:
            continue
        exact = query.lower() == evidence.evidence_number.lower()
        snippet_source = " ".join(part for part in (evidence.evidence_number, evidence.title, evidence.description or "", evidence.evidence_type) if part)
        result = SearchResult(
            type="evidence",
            case_id=case.id,
            case_number=case.case_number,
            evidence_id=evidence.id,
            evidence_number=evidence.evidence_number,
            source_evidence_id=evidence.id,
            title=evidence.title,
            snippet=_snippet(snippet_source, query),
            score=1.0 if exact else 0.7,
            match_type=MatchType.METADATA.value,
        )
        hits[("meta-evidence", evidence.id)] = _Hit(
            key=("meta-evidence", evidence.id), result=result, lexical=result.score, exact=exact, kind=MatchType.METADATA.value
        )


def _document_hit(chunk: SearchChunk, document: Document, version: DocumentVersion, case: Case, query: str) -> _Hit:
    result = SearchResult(
        type="document",
        case_id=case.id,
        case_number=case.case_number,
        document_id=document.id,
        document_number=document.document_number,
        version_id=version.id,
        version_label=version.version_label,
        page_number=chunk.page_number,
        chunk_id=chunk.id,
        title=document.title,
        snippet=_snippet(chunk.text, query),
        score=0,
        match_type=MatchType.LEXICAL.value,
    )
    return _Hit(key=("document", document.id, version.id, chunk.page_number), result=result)


def _evidence_hit(chunk: SearchChunk, resource, case: Case, query: str, artifact: bool) -> _Hit:
    if artifact:
        result = SearchResult(
            type="artifact",
            case_id=case.id,
            case_number=case.case_number,
            evidence_id=resource.source_evidence_id,
            artifact_id=resource.id,
            artifact_number=resource.artifact_number,
            source_evidence_id=resource.source_evidence_id,
            page_number=chunk.page_number,
            chunk_id=chunk.id,
            title=resource.title,
            snippet=_snippet(chunk.text, query),
            score=0,
            match_type=MatchType.LEXICAL.value,
        )
        key = ("artifact", resource.id, chunk.page_number)
    else:
        result = SearchResult(
            type="evidence",
            case_id=case.id,
            case_number=case.case_number,
            evidence_id=resource.id,
            evidence_number=resource.evidence_number,
            source_evidence_id=resource.id,
            page_number=chunk.page_number,
            chunk_id=chunk.id,
            title=resource.title,
            snippet=_snippet(chunk.text, query),
            score=0,
            match_type=MatchType.LEXICAL.value,
        )
        key = ("evidence", resource.id, chunk.page_number)
    return _Hit(key=key, result=result)


def _add_lexical(hits: dict[tuple, _Hit], hit: _Hit, score: float, exact: bool) -> None:
    current = hits.get(hit.key)
    if current is None or score > current.lexical:
        hit.lexical = score
        hit.semantic = current.semantic if current is not None else 0.0
        hit.exact = exact or (current.exact if current else False)
        hits[hit.key] = hit
    elif exact:
        current.exact = True


def _add_semantic(hits: dict[tuple, _Hit], hit: _Hit, score: float) -> None:
    current = hits.get(hit.key)
    if current is None:
        hit.semantic = score
        hit.kind = MatchType.SEMANTIC.value
        hits[hit.key] = hit
        return
    if score > current.semantic:
        current.semantic = score


def _rank(hits: dict[tuple, _Hit], match_type: str | None) -> list[_Hit]:
    settings = get_settings()
    lexical_weight = settings.search_lexical_weight
    semantic_weight = settings.search_semantic_weight
    ranked: list[_Hit] = []
    for hit in hits.values():
        if hit.kind == MatchType.METADATA.value:
            kind = MatchType.METADATA.value
            score = hit.lexical
        elif hit.lexical > 0 and hit.semantic > 0:
            kind = MatchType.HYBRID.value
            score = (hit.lexical * lexical_weight) + (hit.semantic * semantic_weight)
        elif hit.lexical > 0:
            kind = MatchType.LEXICAL.value
            score = hit.lexical
        else:
            kind = MatchType.SEMANTIC.value
            score = hit.semantic
        if hit.exact:
            score = max(score, 0.99)
        if match_type is not None and kind != match_type:
            continue
        hit.result.match_type = kind
        hit.result.score = round(min(1.0, score), 4)
        ranked.append(hit)
    ranked.sort(key=lambda item: (item.result.score, item.exact, item.result.title), reverse=True)
    return ranked


def _shared_filters(document_type, department_id, file_type, date_from, date_to, include_ocr, document_model, case_model):
    clauses = []
    if document_type:
        clauses.append(document_model.document_type == document_type)
    if department_id is not None:
        clauses.append(case_model.department_id == department_id)
    if file_type:
        clauses.append(document_model.mime_type.ilike(_like_contains(file_type), escape="\\"))
    if date_from is not None:
        clauses.append(document_model.created_at >= _start(date_from))
    if date_to is not None:
        clauses.append(document_model.created_at <= _end(date_to))
    if not include_ocr:
        clauses.append(SearchChunk.extraction_method != "OCR")
    return clauses


def _evidence_filters(department_id, file_type, date_from, date_to, include_ocr, model, case_model):
    clauses = []
    if department_id is not None:
        clauses.append(case_model.department_id == department_id)
    if file_type:
        clauses.append(model.mime_type.ilike(_like_contains(file_type), escape="\\"))
    if date_from is not None:
        clauses.append(model.created_at >= _start(date_from))
    if date_to is not None:
        clauses.append(model.created_at <= _end(date_to))
    if not include_ocr:
        clauses.append(SearchChunk.extraction_method != "OCR")
    return clauses


def _version_clause(user: User, include_previous: bool, codes: set[str]):
    official_row = aliased(DocumentVersion)
    no_official = ~exists(
        select(official_row.id).where(
            official_row.document_id == Document.id,
            official_row.is_official.is_(True),
        )
    )
    visible = or_(
        DocumentVersion.is_official.is_(True),
        and_(no_official, DocumentVersion.created_by == user.id),
    )
    if not include_previous or "REVISION.READ" not in codes:
        return visible
    historical = DocumentVersion.status.in_(_HISTORICAL)
    role_name = user.role.name if user.role is not None else ""
    if role_name in {RoleName.ADMIN.value, RoleName.POLICE_SUPERVISOR.value}:
        return or_(visible, historical, DocumentVersion.status.in_(_DRAFTS))
    return or_(visible, historical, and_(DocumentVersion.status.in_(_DRAFTS), DocumentVersion.created_by == user.id))


def _accessible_case_ids(db: Session, user: User, codes: set[str]) -> list[uuid.UUID]:
    role_name = user.role.name if user.role is not None else None
    if role_has_system_case_access(role_name) and "CASE.READ" in codes:
        return list(db.scalars(select(Case.id)))
    now = datetime.now(timezone.utc)
    assigned = db.scalars(
        select(CaseAssignment.case_id).where(CaseAssignment.user_id == user.id, CaseAssignment.active.is_(True))
    )
    granted = db.scalars(
        select(AccessRequest.case_id).where(
            AccessRequest.requester_id == user.id,
            AccessRequest.status == "APPROVED",
            or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
        )
    )
    return list({*assigned, *granted})


def _selected_version(db: Session, user: User, document: Document, version_id: uuid.UUID | None, codes: set[str]) -> DocumentVersion:
    if version_id is None:
        version = db.scalar(
            select(DocumentVersion).where(DocumentVersion.document_id == document.id, DocumentVersion.is_official.is_(True))
        )
        if version is None:
            raise AppError(409, "conflict", "No official version is available.")
        return version
    version = db.scalar(
        select(DocumentVersion).where(DocumentVersion.id == version_id, DocumentVersion.document_id == document.id)
    )
    if version is None or not _version_allowed(user, version, codes):
        raise AppError(404, "not_found", "Document not found.")
    return version


def _version_allowed(user: User, version: DocumentVersion, codes: set[str]) -> bool:
    if version.is_official:
        return True
    if "REVISION.READ" not in codes:
        return False
    if version.status in _HISTORICAL:
        return True
    if version.status not in _DRAFTS:
        return False
    role_name = user.role.name if user.role is not None else ""
    if role_name in {RoleName.ADMIN.value, RoleName.POLICE_SUPERVISOR.value}:
        return True
    return version.created_by == user.id


def _visible_document(db: Session, user: User, document_id: uuid.UUID) -> Document:
    from app.services.document_service import _load, _require_visible

    document = _load(db, document_id)
    _require_visible(user, document)
    return document


def _audit_search(db: Session, user: User, mode: str, results: list[_Hit]) -> None:
    counts: dict[uuid.UUID, int] = {}
    for hit in results:
        counts[hit.result.case_id] = counts.get(hit.result.case_id, 0) + 1
    if not counts:
        from app.services.audit_service import record

        record("SEARCH_PERFORMED", user_id=user.id, metadata={"mode": mode, "results": "0"})
        return
    try:
        for case_id, count in counts.items():
            add_event(
                db,
                case_id=case_id,
                event_type=CaseEventType.SEARCH_PERFORMED,
                message=f"Search completed in {mode} mode. {count} result(s) from this case.",
                actor_id=user.id,
            )
        db.commit()
    except Exception:
        logger.exception("Search audit event failed")
        db.rollback()
    from app.services.audit_service import record

    record(
        "SEARCH_PERFORMED",
        user_id=user.id,
        case_id=next(iter(counts)) if len(counts) == 1 else None,
        metadata={"mode": mode, "results": str(sum(counts.values()))},
    )


def _query_vector(query: str, mode: str) -> list[float] | None:
    if mode == SearchMode.LEXICAL.value:
        return None
    try:
        return embed_text(query)
    except EmbeddingError:
        return None
    except Exception:
        logger.exception("Query embedding failed")
        return None


def _semantic_ready(query: str, mode: str) -> bool:
    if mode == SearchMode.LEXICAL.value:
        return False
    return _query_vector(query, mode) is not None


def _lexical_score(raw_rank, text: str, query: str) -> float:
    raw = float(raw_rank or 0)
    score = raw / (raw + 1.0) if raw > 0 else 0.45
    if query.lower() in text.lower():
        score = max(score, 0.99)
    return min(1.0, score)


def _is_exact(text: str, document: Document | None, case: Case, query: str) -> bool:
    needle = query.lower()
    if needle in text.lower():
        return True
    if document is not None and needle == document.document_number.lower():
        return True
    return needle == case.case_number.lower()


def _number_exact(resource, query: str) -> bool:
    number = getattr(resource, "evidence_number", None) or getattr(resource, "artifact_number", None)
    return bool(number) and query.lower() == number.lower()


def _snippet(text: str, query: str) -> str:
    compact = " ".join(text.split())
    lowered = compact.lower()
    needle = query.strip().lower()
    position = lowered.find(needle)
    if position < 0:
        for token in needle.split():
            if len(token) < 2:
                continue
            position = lowered.find(token)
            if position >= 0:
                needle = token
                break
    if position < 0:
        cut = compact[:160]
        return cut + ("..." if len(compact) > 160 else "")
    start = max(0, position - 70)
    end = min(len(compact), position + len(needle) + 70)
    prefix = "..." if start else ""
    suffix = "..." if end < len(compact) else ""
    return f"{prefix}{compact[start:end]}{suffix}"


def _like_contains(value: str) -> str:
    return f"%{_escape_like(value)}%"


def _like_prefix(value: str) -> str:
    return f"{_escape_like(value)}%"


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _start(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def _end(value: date) -> datetime:
    return datetime.combine(value, time.max, tzinfo=timezone.utc)
