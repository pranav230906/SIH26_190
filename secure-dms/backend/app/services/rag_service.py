"""Case-isolated retrieval. The model receives only chunks that already passed authorization."""

import logging
import re
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.authorization.permission_service import authorize, effective_permission_codes, user_has_case_access
from app.constants import Action, CaseEventType, DocumentVersionStatus, ResourceType, SearchMode
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.models.case import Case
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import DerivedArtifact, Evidence
from app.models.rag import RagCitation, RagConversation, RagMessage
from app.models.search import SearchChunk
from app.models.user import User
from app.schemas.rag import (
    RagCaseOption,
    RagCasesResponse,
    RagCitationOut,
    RagConversationDetail,
    RagConversationList,
    RagConversationSummary,
    RagMessageOut,
    RagQueryResponse,
)
from app.services.case_service import list_cases
from app.services.case_timeline import add_event
from app.services.llm_provider import INSUFFICIENT, LLMResult, get_provider
from app.services.rag_context import ContextChunk, build_context
from app.services.search_service import search

logger = logging.getLogger("secure_dms.rag")

DENIED = "Access to this case is not permitted."
OUTSIDE = "I can only answer using the authorized documents for the selected case."
NO_HITS = "No relevant information was found in the authorized documents for this case."
RETRIEVAL_FAILED = "Document retrieval is currently unavailable."
_OTHER_CASE = re.compile(r"\b(other cases|another case|all cases|every case|other case)\b", re.IGNORECASE)
_OVERRIDE = re.compile(
    r"ignore (all |your |previous |the )?(instructions|rules)|reveal all (documents|cases|files)",
    re.IGNORECASE,
)
_COMPARE = re.compile(r"previous versions|compare versions|older version|version history", re.IGNORECASE)
_CASE_NUMBER = re.compile(r"CASE-\d{4}-\d{3}", re.IGNORECASE)
_DRAFTS = {
    DocumentVersionStatus.DRAFT.value,
    DocumentVersionStatus.REJECTED.value,
    DocumentVersionStatus.SUBMITTED_FOR_REVIEW.value,
}
_requests: dict[uuid.UUID, list[float]] = {}


def list_assistant_cases(db: Session, user: User) -> RagCasesResponse:
    items, _total = list_cases(db, user, page=1, page_size=100)
    settings = get_settings()
    return RagCasesResponse(
        cases=[RagCaseOption(id=item.id, case_number=item.case_number, title=item.title) for item in items],
        provider=settings.llm_provider,
        demo_mode=settings.llm_provider == "demo",
    )


def ask(db: Session, user: User, *, case_id: uuid.UUID, question: str, conversation_id: uuid.UUID | None) -> RagQueryResponse:
    settings = get_settings()
    cleaned = " ".join(question.split())
    if not cleaned:
        raise AppError(422, "validation_error", "Enter a question.")
    if len(cleaned) > settings.rag_max_question_chars:
        raise AppError(422, "validation_error", "The question is too long.")
    _limit(user.id)
    case = _authorized_case(db, user, case_id)
    refusal = _scope_refusal(cleaned)
    if refusal is not None:
        conversation = _conversation(db, user, case, conversation_id)
        return _store(db, user, case, conversation, cleaned, refusal, [], _authorized_document_count(db, user, case.id))
    compare = bool(_COMPARE.search(cleaned)) and "REVISION.READ" in set(effective_permission_codes(user))
    try:
        found = search(
            db,
            user,
            query=_retrieval_question(cleaned),
            mode=SearchMode.HYBRID.value,
            case_id=case.id,
            include_previous=compare,
            include_evidence=True,
            include_ocr=True,
            record_audit=False,
        )
    except AppError:
        raise
    except Exception:
        logger.exception("Case retrieval failed")
        raise AppError(503, "service_unavailable", RETRIEVAL_FAILED) from None
    chunks = _authorized_chunks(db, user, case, found.results, compare)
    chunks = [chunk for chunk in chunks if chunk.score >= settings.rag_min_score]
    authorized_documents = _authorized_document_count(db, user, case.id)
    conversation = _conversation(db, user, case, conversation_id)
    if not chunks:
        result = LLMResult(answer=NO_HITS, grounding_status=INSUFFICIENT, cited=[], demo_mode=settings.llm_provider == "demo")
        return _store(db, user, case, conversation, cleaned, result, [], authorized_documents)
    _context, selected = build_context(chunks)
    if not selected:
        result = LLMResult(answer=NO_HITS, grounding_status=INSUFFICIENT, cited=[], demo_mode=settings.llm_provider == "demo")
        return _store(db, user, case, conversation, cleaned, result, [], authorized_documents)
    provider = get_provider()
    generated = provider.generate(cleaned, selected)
    generated.answer = _guard_answer(generated.answer, case.case_number)
    if generated.grounding_status == INSUFFICIENT:
        cited = []
    elif generated.cited:
        cited = generated.cited
    else:
        cited = selected
    return _store(db, user, case, conversation, cleaned, generated, cited, authorized_documents)


def list_conversations(db: Session, user: User, case_id: uuid.UUID | None) -> RagConversationList:
    statement = select(RagConversation).where(RagConversation.user_id == user.id).order_by(RagConversation.updated_at.desc())
    if case_id is not None:
        case = _authorized_case(db, user, case_id)
        statement = statement.where(RagConversation.case_id == case.id)
    rows = db.scalars(statement.limit(50)).all()
    visible = []
    for row in rows:
        case = db.get(Case, row.case_id)
        if case is None or not _can_read_case(user, case):
            continue
        visible.append(
            RagConversationSummary(
                id=row.id,
                case_id=case.id,
                case_number=case.case_number,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )
    return RagConversationList(conversations=visible)


def get_conversation(db: Session, user: User, conversation_id: uuid.UUID) -> RagConversationDetail:
    row = db.scalar(
        select(RagConversation)
        .options(selectinload(RagConversation.messages).selectinload(RagMessage.citations))
        .where(RagConversation.id == conversation_id, RagConversation.user_id == user.id)
    )
    if row is None:
        raise AppError(404, "not_found", DENIED)
    case = db.get(Case, row.case_id)
    if case is None or not _can_read_case(user, case):
        raise AppError(404, "not_found", DENIED)
    return RagConversationDetail(
        id=row.id,
        case_id=case.id,
        case_number=case.case_number,
        created_at=row.created_at,
        updated_at=row.updated_at,
        messages=[_message_out(item) for item in row.messages],
    )


def _authorized_case(db: Session, user: User, case_id: uuid.UUID) -> Case:
    case = db.get(Case, case_id)
    if case is None or not _can_read_case(user, case):
        raise AppError(404, "not_found", DENIED)
    return case


def _can_read_case(user: User, case: Case) -> bool:
    if not user_has_case_access(user, case):
        return False
    return authorize(user, Action.READ, ResourceType.CASE, case=case).allowed


def _conversation(db: Session, user: User, case: Case, conversation_id: uuid.UUID | None) -> RagConversation:
    if conversation_id is None:
        conversation = RagConversation(user_id=user.id, case_id=case.id)
        db.add(conversation)
        db.flush()
        return conversation
    conversation = db.scalar(
        select(RagConversation).where(RagConversation.id == conversation_id, RagConversation.user_id == user.id)
    )
    if conversation is None or conversation.case_id != case.id:
        raise AppError(404, "not_found", DENIED)
    return conversation


def _authorized_chunks(db: Session, user: User, case: Case, results, compare: bool) -> list[ContextChunk]:
    chunks: list[ContextChunk] = []
    for result in results:
        if result.case_id != case.id or result.chunk_id is None:
            continue
        row = db.get(SearchChunk, result.chunk_id)
        if row is None or row.case_id != case.id:
            continue
        if not _chunk_allowed(db, user, case, row, compare):
            continue
        version_label = result.version_label
        chunks.append(
            ContextChunk(
                chunk_id=str(row.id),
                case_id=str(case.id),
                document_id=str(row.document_id) if row.document_id else None,
                document_title=result.title,
                version_id=str(row.version_id) if row.version_id else None,
                version_label=version_label,
                page_number=row.page_number,
                source_type=row.content_type,
                text=row.text,
                score=result.score,
                evidence_id=str(row.evidence_id) if row.evidence_id else None,
                artifact_id=str(row.artifact_id) if row.artifact_id else None,
                snippet=_snippet(row.text),
            )
        )
    return chunks


def _chunk_allowed(db: Session, user: User, case: Case, row: SearchChunk, compare: bool) -> bool:
    if row.document_id is not None:
        document = db.get(Document, row.document_id)
        version = db.get(DocumentVersion, row.version_id) if row.version_id else None
        if document is None or document.case_id != case.id:
            return False
        if not authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=case).allowed:
            return False
        if version is None:
            return False
        if version.status == DocumentVersionStatus.REJECTED.value:
            return False
        if version.status in _DRAFTS and not compare:
            return False
        if not version.is_official and not compare:
            return False
        return True
    if row.artifact_id is not None:
        artifact = db.get(DerivedArtifact, row.artifact_id)
        if artifact is None or artifact.case_id != case.id:
            return False
        return authorize(user, Action.READ, ResourceType.DERIVED_ARTIFACT, resource=artifact, case=case).allowed
    if row.evidence_id is not None:
        evidence = db.get(Evidence, row.evidence_id)
        if evidence is None or evidence.case_id != case.id:
            return False
        return authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=case).allowed
    return False


def _authorized_document_count(db: Session, user: User, case_id: uuid.UUID) -> int:
    from app.services.document_service import _readable_clause

    count = db.scalar(
        select(func.count()).select_from(Document).where(Document.case_id == case_id, _readable_clause(user))
    )
    return int(count or 0)


def _store(
    db: Session,
    user: User,
    case: Case,
    conversation: RagConversation,
    question: str,
    result: LLMResult | str,
    cited: list[ContextChunk],
    authorized_documents: int,
) -> RagQueryResponse:
    if isinstance(result, str):
        answer = result
        grounding = INSUFFICIENT
        provider_name = get_settings().llm_provider
        demo = provider_name == "demo"
        cited = []
    else:
        answer = result.answer
        grounding = result.grounding_status
        provider_name = get_provider().name
        demo = result.demo_mode
    message = RagMessage(
        conversation_id=conversation.id,
        question=question,
        answer=answer,
        grounding_status=grounding,
        provider=provider_name,
    )
    db.add(message)
    db.flush()
    citations = []
    seen: set[str] = set()
    for chunk in cited:
        if chunk.chunk_id in seen:
            continue
        seen.add(chunk.chunk_id)
        citation = RagCitation(
            message_id=message.id,
            chunk_id=uuid.UUID(chunk.chunk_id),
            document_id=uuid.UUID(chunk.document_id) if chunk.document_id else None,
            version_id=uuid.UUID(chunk.version_id) if chunk.version_id else None,
            evidence_id=uuid.UUID(chunk.evidence_id) if chunk.evidence_id else None,
            artifact_id=uuid.UUID(chunk.artifact_id) if chunk.artifact_id else None,
            title=chunk.document_title[:200],
            version_label=chunk.version_label,
            page_number=chunk.page_number,
            snippet=chunk.snippet,
        )
        db.add(citation)
        citations.append(_citation_out(citation))
    conversation.updated_at = datetime.now(timezone.utc)
    add_event(
        db,
        case_id=case.id,
        event_type=CaseEventType.RAG_QUERY_EXECUTED,
        message=f"Case assistant query completed. {len(citations)} source(s).",
        actor_id=user.id,
    )
    db.commit()
    from app.services.audit_service import record

    record(
        "RAG_QUERY_EXECUTED",
        user_id=user.id,
        case_id=case.id,
        metadata={"sources": str(len(citations))},
    )
    return RagQueryResponse(
        conversation_id=conversation.id,
        message_id=message.id,
        case_id=case.id,
        case_number=case.case_number,
        answer=answer,
        grounding_status=grounding,
        demo_mode=demo,
        provider=provider_name,
        authorized_documents=authorized_documents,
        retrieved_sources=len(citations),
        citations=citations,
    )


def _message_out(message: RagMessage) -> RagMessageOut:
    return RagMessageOut(
        id=message.id,
        question=message.question,
        answer=message.answer,
        grounding_status=message.grounding_status,
        created_at=message.created_at,
        citations=[_citation_out(item) for item in message.citations],
    )


def _citation_out(citation: RagCitation) -> RagCitationOut:
    return RagCitationOut(
        document_id=citation.document_id,
        document_title=citation.title,
        version_id=citation.version_id,
        version_label=citation.version_label,
        page_number=citation.page_number,
        chunk_id=citation.chunk_id,
        evidence_id=citation.evidence_id,
        artifact_id=citation.artifact_id,
        snippet=citation.snippet,
    )


def _scope_refusal(question: str) -> str | None:
    if _OTHER_CASE.search(question):
        return OUTSIDE
    if _OVERRIDE.search(question) and not _retrieval_question(question).strip():
        return OUTSIDE
    return None


def _retrieval_question(question: str) -> str:
    return " ".join(_OVERRIDE.sub(" ", question).split())


def _guard_answer(answer: str, case_number: str) -> str:
    for found in _CASE_NUMBER.findall(answer):
        if found.upper() != case_number.upper():
            return OUTSIDE
    return answer


def _snippet(text: str) -> str:
    compact = " ".join(text.split())
    if len(compact) <= 240:
        return compact
    return compact[:237] + "..."


def _limit(user_id: uuid.UUID) -> None:
    settings = get_settings()
    now = time.monotonic()
    recent = [stamp for stamp in _requests.get(user_id, []) if now - stamp < settings.rag_rate_window_seconds]
    if len(recent) >= settings.rag_rate_limit:
        raise AppError(429, "rate_limited", "Too many case assistant requests. Wait a moment and try again.")
    recent.append(now)
    _requests[user_id] = recent
