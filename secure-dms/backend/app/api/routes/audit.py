"""Read and verify the append-only audit chain. Update and delete are not offered."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.case import Case
from app.models.document import Document
from app.models.evidence import Evidence
from app.models.user import User
from app.schemas.audit import AuditEventDetail, AuditEventList, AuditStatus, AuditSummary, AuditVerifyResult
from app.schemas.common import ErrorResponse
from app.services.audit_service import export_events, get_event, list_events, status, summary, verify

router = APIRouter(prefix="/audit", tags=["Audit"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
}


@router.get("/events", response_model=AuditEventList, responses=_ERRORS)
def read_events(
    case_id: uuid.UUID | None = None,
    document_id: uuid.UUID | None = None,
    evidence_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    event_type: str | None = None,
    severity: str | None = None,
    case_number: str | None = None,
    document_number: str | None = None,
    evidence_number: str | None = None,
    username: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AuditEventList:
    case_id, document_id, evidence_id, user_id = _resolve_filters(
        db, case_id, document_id, evidence_id, user_id, case_number, document_number, evidence_number, username
    )
    return list_events(
        db,
        current_user,
        case_id=case_id,
        document_id=document_id,
        evidence_id=evidence_id,
        actor_id=user_id,
        event_type=event_type,
        severity=severity,
        start_date=start_date,
        end_date=end_date,
        page=page,
        page_size=page_size,
    )


@router.get("/events/{event_id}", response_model=AuditEventDetail, responses=_ERRORS)
def read_event(
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AuditEventDetail:
    return get_event(db, current_user, event_id)


@router.get("/summary", response_model=AuditSummary, responses=_ERRORS)
def read_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AuditSummary:
    return summary(db, current_user)


@router.get("/status", response_model=AuditStatus, responses=_ERRORS)
def read_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AuditStatus:
    return status(db, current_user)


@router.post("/verify", response_model=AuditVerifyResult, responses=_ERRORS)
def verify_chain(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AuditVerifyResult:
    return verify(db, current_user)


@router.get("/export", responses=_ERRORS)
def export_chain(
    case_id: uuid.UUID | None = None,
    document_id: uuid.UUID | None = None,
    evidence_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    event_type: str | None = None,
    severity: str | None = None,
    case_number: str | None = None,
    document_number: str | None = None,
    evidence_number: str | None = None,
    username: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    export_format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> Response:
    case_id, document_id, evidence_id, user_id = _resolve_filters(
        db, case_id, document_id, evidence_id, user_id, case_number, document_number, evidence_number, username
    )
    filename, media, body = export_events(
        db,
        current_user,
        case_id=case_id,
        document_id=document_id,
        evidence_id=evidence_id,
        actor_id=user_id,
        event_type=event_type,
        severity=severity,
        start_date=start_date,
        end_date=end_date,
        export_format=export_format,
    )
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _resolve_filters(db, case_id, document_id, evidence_id, user_id, case_number, document_number, evidence_number, username):
    missing = uuid.UUID(int=0)
    if case_id is None and case_number:
        found = db.scalar(select(Case.id).where(Case.case_number == case_number.strip()))
        case_id = found or missing
    if document_id is None and document_number:
        found = db.scalar(select(Document.id).where(Document.document_number == document_number.strip()))
        document_id = found or missing
    if evidence_id is None and evidence_number:
        found = db.scalar(select(Evidence.id).where(Evidence.evidence_number == evidence_number.strip()))
        evidence_id = found or missing
    if user_id is None and username:
        found = db.scalar(select(User.id).where(User.username == username.strip()))
        user_id = found or missing
    return case_id, document_id, evidence_id, user_id
