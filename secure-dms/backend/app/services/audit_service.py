"""Append-only SHA-256 audit chain. This log is tamper-evident, not tamper-proof."""

import csv
import hashlib
import io
import json
import logging
import uuid
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.authorization.permission_service import effective_permission_codes, user_has_case_access
from app.constants import Action, ResourceType
from app.core.database import SessionLocal
from app.core.exceptions import AppError
from app.core.request_context import client_ip, client_user_agent
from app.models.audit_event import AuditEvent
from app.models.case import Case
from app.models.document import Document
from app.models.user import User
from app.schemas.audit import (
    AuditEventDetail,
    AuditEventList,
    AuditEventSummary,
    AuditStatus,
    AuditSummary,
    AuditVerifyResult,
)

logger = logging.getLogger("secure_dms.audit")

GENESIS = "GENESIS"
HASH_ALGORITHM = "SHA-256"
VALID = "VALID"
TAMPER = "TAMPER_DETECTED"
NOT_VERIFIED = "NOT_VERIFIED"
_PAGE_MAX = 50
_EXPORT_MAX = 500
_SEVERITY = {
    "LOGIN_FAILURE": "SECURITY",
    "UNAUTHORIZED_DOCUMENT_ACCESS_ATTEMPT": "SECURITY",
    "UNAUTHORIZED_CASE_ACCESS_ATTEMPT": "SECURITY",
    "UNAUTHORIZED_ACCESS_ATTEMPT": "SECURITY",
    "INTEGRITY_FAILURE_DETECTED": "SECURITY",
    "ACCESS_REQUEST_CREATED": "WARNING",
    "ACCESS_REQUEST_APPROVED": "WARNING",
    "ACCESS_REQUEST_REJECTED": "WARNING",
    "PERMISSION_CHANGED": "WARNING",
    "USER_CREATED": "WARNING",
    "USER_ROLE_CHANGED": "WARNING",
}


def record(
    event_type: str,
    *,
    user_id: uuid.UUID | None = None,
    case_id: uuid.UUID | None = None,
    document_id: uuid.UUID | None = None,
    version_id: uuid.UUID | None = None,
    evidence_id: uuid.UUID | None = None,
    request_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> None:
    """Insert one chained event in its own transaction. Failures are logged, not raised."""
    db = SessionLocal()
    try:
        _insert(
            db,
            event_type=event_type,
            user_id=user_id,
            case_id=case_id,
            document_id=document_id,
            version_id=version_id,
            evidence_id=evidence_id,
            request_id=request_id,
            metadata=metadata or {},
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Audit event was not recorded")
    finally:
        db.close()


def list_events(
    db: Session,
    user: User,
    *,
    case_id: uuid.UUID | None,
    document_id: uuid.UUID | None,
    evidence_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    event_type: str | None,
    severity: str | None,
    start_date,
    end_date,
    page: int,
    page_size: int,
) -> AuditEventList:
    page_size = min(max(page_size, 1), _PAGE_MAX)
    rows = _visible_rows(db, user, case_id, document_id, evidence_id, actor_id, event_type, severity, start_date, end_date)
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]
    return AuditEventList(
        items=[_summary(db, user, row) for row in page_rows],
        total=len(rows),
        page=page,
        page_size=page_size,
    )


def get_event(db: Session, user: User, event_id: uuid.UUID) -> AuditEventDetail:
    row = db.get(AuditEvent, event_id)
    if row is None or not _visible(db, user, row):
        raise AppError(404, "not_found", "Audit event not found.")
    summary = _summary(db, user, row)
    summary.integrity = _local_integrity(db, row)
    return AuditEventDetail(
        **summary.model_dump(),
        version_id=row.version_id,
        evidence_id=row.evidence_id,
        request_id=row.request_id,
        ip_address=row.ip_address,
        user_agent=row.user_agent,
        metadata=row.metadata_json or {},
        previous_hash=row.previous_hash,
        event_hash=row.event_hash,
        hash_algorithm=row.hash_algorithm,
    )


def summary(db: Session, user: User) -> AuditSummary:
    rows = _visible_rows(db, user, None, None, None, None, None, None, None, None)
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return AuditSummary(
        total_events=len(rows),
        events_today=sum(1 for row in rows if _as_utc(row.created_at) >= start),
        security_events=sum(1 for row in rows if row.severity == "SECURITY"),
        failed_logins=sum(1 for row in rows if row.event_type == "LOGIN_FAILURE"),
        access_requests=sum(1 for row in rows if row.event_type.startswith("ACCESS_REQUEST_")),
        system_wide=_system_wide(user),
    )


def status(db: Session, user: User) -> AuditStatus:
    _require_auditor(user)
    latest = db.scalar(
        select(AuditEvent)
        .where(AuditEvent.event_type.in_(("INTEGRITY_CHECK_PERFORMED", "INTEGRITY_FAILURE_DETECTED")))
        .order_by(AuditEvent.sequence.desc())
        .limit(1)
    )
    if latest is None:
        return AuditStatus(status=NOT_VERIFIED, last_verified_at=None, events_checked=0)
    payload = latest.metadata_json or {}
    return AuditStatus(
        status=str(payload.get("result") or NOT_VERIFIED),
        last_verified_at=latest.created_at,
        events_checked=int(payload.get("events_checked") or 0),
        failed_event_id=payload.get("failed_event_id"),
        reason=payload.get("reason"),
    )


def verify(db: Session, user: User) -> AuditVerifyResult:
    _require_auditor(user)
    result = _walk(db)
    record(
        "INTEGRITY_FAILURE_DETECTED" if result.status == TAMPER else "INTEGRITY_CHECK_PERFORMED",
        user_id=user.id,
        metadata={
            "result": result.status,
            "events_checked": result.events_checked,
            "failed_event_id": str(result.failed_event_id) if result.failed_event_id else "",
            "reason": result.reason or "",
        },
    )
    return result


def export_events(
    db: Session,
    user: User,
    *,
    case_id: uuid.UUID | None,
    document_id: uuid.UUID | None,
    evidence_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    event_type: str | None,
    severity: str | None,
    start_date,
    end_date,
    export_format: str,
) -> tuple[str, str, bytes]:
    rows = _visible_rows(db, user, case_id, document_id, evidence_id, actor_id, event_type, severity, start_date, end_date)
    rows = list(reversed(rows))[:_EXPORT_MAX]
    items = [_summary(db, user, row) for row in rows]
    if export_format == "csv":
        body = _csv(items)
        media = "text/csv"
        filename = "audit-events.csv"
    else:
        body = json.dumps([item.model_dump(mode="json") for item in items], indent=2).encode("utf-8")
        media = "application/json"
        filename = "audit-events.json"
    record(
        "AUDIT_EXPORT",
        user_id=user.id,
        case_id=case_id,
        metadata={"format": export_format, "rows": len(items)},
    )
    return filename, media, body


def _insert(db: Session, **fields) -> AuditEvent:
    from sqlalchemy import text

    db.execute(text("SELECT pg_advisory_xact_lock(19026)"))
    latest = db.scalar(select(AuditEvent).order_by(AuditEvent.sequence.desc()).limit(1).with_for_update())
    previous = latest.event_hash if latest is not None else GENESIS
    created = datetime.now(timezone.utc)
    canonical_time = created.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    metadata = _plain_metadata(fields["metadata"])
    canonical = _canonical(
        event_type=fields["event_type"],
        user_id=fields["user_id"],
        case_id=fields["case_id"],
        document_id=fields["document_id"],
        version_id=fields["version_id"],
        evidence_id=fields["evidence_id"],
        request_id=fields["request_id"],
        metadata=metadata,
        created_at=canonical_time,
        previous_hash=previous,
        ip_address=client_ip(),
        user_agent=client_user_agent(),
    )
    event = AuditEvent(
        sequence=(latest.sequence + 1) if latest is not None else 1,
        event_type=fields["event_type"],
        severity=_SEVERITY.get(fields["event_type"], "INFO"),
        user_id=fields["user_id"],
        case_id=fields["case_id"],
        document_id=fields["document_id"],
        version_id=fields["version_id"],
        evidence_id=fields["evidence_id"],
        request_id=fields["request_id"],
        ip_address=client_ip(),
        user_agent=client_user_agent(),
        metadata_json=metadata,
        canonical_time=canonical_time,
        created_at=created,
        previous_hash=previous,
        event_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        hash_algorithm=HASH_ALGORITHM,
    )
    db.add(event)
    db.flush()
    return event


def _walk(db: Session) -> AuditVerifyResult:
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.sequence.asc())).all()
    expected_previous = GENESIS
    for row in rows:
        recalculated = hashlib.sha256(
            _canonical(
                event_type=row.event_type,
                user_id=row.user_id,
                case_id=row.case_id,
                document_id=row.document_id,
                version_id=row.version_id,
                evidence_id=row.evidence_id,
                request_id=row.request_id,
                metadata=row.metadata_json or {},
                created_at=row.canonical_time,
                previous_hash=row.previous_hash,
                ip_address=row.ip_address,
                user_agent=row.user_agent,
            ).encode("utf-8")
        ).hexdigest()
        if recalculated != row.event_hash:
            return AuditVerifyResult(
                status=TAMPER,
                events_checked=len(rows),
                failed_event_id=row.id,
                reason="EVENT_HASH_MISMATCH",
            )
        if row.previous_hash != expected_previous:
            return AuditVerifyResult(
                status=TAMPER,
                events_checked=len(rows),
                failed_event_id=row.id,
                reason="CHAIN_BROKEN",
            )
        expected_previous = row.event_hash
    return AuditVerifyResult(status=VALID, events_checked=len(rows))


def _canonical(**fields) -> str:
    payload = {
        "case_id": _token(fields["case_id"]),
        "created_at": fields["created_at"],
        "document_id": _token(fields["document_id"]),
        "event_type": fields["event_type"],
        "evidence_id": _token(fields["evidence_id"]),
        "ip_address": fields["ip_address"] or "",
        "metadata": fields["metadata"],
        "previous_hash": fields["previous_hash"],
        "request_id": _token(fields["request_id"]),
        "user_agent": fields["user_agent"] or "",
        "user_id": _token(fields["user_id"]),
        "version_id": _token(fields["version_id"]),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _plain_metadata(value: dict) -> dict:
    return json.loads(json.dumps(value, sort_keys=True, default=_token))


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _token(value) -> str:
    if value is None:
        return ""
    return str(value)


def _scoped_statement(db, user, case_id, document_id, evidence_id, actor_id, event_type, severity, start_date, end_date):
    statement = select(AuditEvent)
    if not _system_wide(user):
        from app.services.search_service import _accessible_case_ids

        case_ids = _accessible_case_ids(db, user, set(effective_permission_codes(user)))
        statement = statement.where(
            or_(
                AuditEvent.case_id.in_(case_ids or [uuid.uuid4()]),
                (AuditEvent.case_id.is_(None) & (AuditEvent.user_id == user.id)),
                ((AuditEvent.user_id == user.id) & (AuditEvent.severity == "SECURITY")),
            )
        )
    if case_id is not None:
        if not _system_wide(user):
            case = db.get(Case, case_id)
            if case is None or not user_has_case_access(user, case):
                statement = statement.where(AuditEvent.id.is_(None))
        statement = statement.where(AuditEvent.case_id == case_id)
    if document_id is not None:
        if not _can_see_document(db, user, document_id):
            statement = statement.where(AuditEvent.id.is_(None))
        statement = statement.where(AuditEvent.document_id == document_id)
    if evidence_id is not None:
        statement = statement.where(AuditEvent.evidence_id == evidence_id)
    if actor_id is not None:
        statement = statement.where(AuditEvent.user_id == actor_id)
    if event_type:
        statement = statement.where(AuditEvent.event_type == event_type)
    if severity:
        statement = statement.where(AuditEvent.severity == severity)
    if start_date is not None:
        statement = statement.where(AuditEvent.created_at >= datetime.combine(start_date, time.min, tzinfo=timezone.utc))
    if end_date is not None:
        statement = statement.where(AuditEvent.created_at < datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc))
    return statement


def _visible_rows(db, user, case_id, document_id, evidence_id, actor_id, event_type, severity, start_date, end_date) -> list[AuditEvent]:
    statement = _scoped_statement(db, user, case_id, document_id, evidence_id, actor_id, event_type, severity, start_date, end_date)
    rows = db.scalars(statement.order_by(AuditEvent.sequence.desc())).all()
    return [row for row in rows if _visible(db, user, row)]


def _visible(db: Session, user: User, row: AuditEvent) -> bool:
    if _system_wide(user):
        return True
    if row.user_id == user.id and row.severity == "SECURITY":
        return True
    if row.case_id is None:
        return row.user_id == user.id
    case = db.get(Case, row.case_id)
    if case is None or not user_has_case_access(user, case):
        return False
    if row.document_id is not None and not _can_see_document(db, user, row.document_id):
        return row.user_id == user.id and row.severity == "SECURITY"
    if row.evidence_id is not None and not _can_see_evidence(db, user, row.evidence_id):
        return row.user_id == user.id and row.severity == "SECURITY"
    return True


def _local_integrity(db: Session, row: AuditEvent) -> str:
    recalculated = hashlib.sha256(
        _canonical(
            event_type=row.event_type,
            user_id=row.user_id,
            case_id=row.case_id,
            document_id=row.document_id,
            version_id=row.version_id,
            evidence_id=row.evidence_id,
            request_id=row.request_id,
            metadata=row.metadata_json or {},
            created_at=row.canonical_time,
            previous_hash=row.previous_hash,
            ip_address=row.ip_address,
            user_agent=row.user_agent,
        ).encode("utf-8")
    ).hexdigest()
    if recalculated != row.event_hash:
        return "EVENT_HASH_MISMATCH"
    if row.sequence == 1:
        return "VERIFIED" if row.previous_hash == GENESIS else "CHAIN_BROKEN"
    prior = db.scalar(select(AuditEvent).where(AuditEvent.sequence == row.sequence - 1))
    if prior is None or row.previous_hash != prior.event_hash:
        return "CHAIN_BROKEN"
    return "VERIFIED"


def _can_see_evidence(db: Session, user: User, evidence_id: uuid.UUID) -> bool:
    if _system_wide(user):
        return True
    from app.authorization.permission_service import authorize
    from app.models.evidence import Evidence

    evidence = db.get(Evidence, evidence_id)
    if evidence is None or evidence.case is None:
        return False
    return authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=evidence.case).allowed


def _can_see_document(db: Session, user: User, document_id: uuid.UUID) -> bool:
    if _system_wide(user):
        return True
    document = db.get(Document, document_id)
    if document is None or document.case is None:
        return False
    from app.authorization.permission_service import authorize

    return authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=document.case).allowed


def _summary(db: Session, user: User, row: AuditEvent) -> AuditEventSummary:
    actor = db.get(User, row.user_id) if row.user_id else None
    case = db.get(Case, row.case_id) if row.case_id else None
    document = db.get(Document, row.document_id) if row.document_id else None
    show_document = bool(row.document_id) and (_system_wide(user) or (document is not None and _can_see_document(db, user, document.id)))
    return AuditEventSummary(
        id=row.id,
        sequence=row.sequence,
        event_type=row.event_type,
        severity=row.severity,
        user_id=row.user_id,
        user_name=actor.full_name if actor is not None else None,
        case_id=row.case_id,
        case_number=case.case_number if case is not None else None,
        document_id=row.document_id if show_document else None,
        document_title=document.title if show_document else None,
        created_at=row.created_at,
        integrity="RECORDED",
    )


def _system_wide(user: User) -> bool:
    return "AUDIT_LOG.READ" in set(effective_permission_codes(user))


def _require_auditor(user: User) -> None:
    if not _system_wide(user):
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")


def _csv(items: list[AuditEventSummary]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=["created_at", "user_name", "event_type", "severity", "case_number", "document_title"],
    )
    writer.writeheader()
    for item in items:
        writer.writerow(
            {
                "created_at": item.created_at.isoformat(),
                "user_name": item.user_name or "",
                "event_type": item.event_type,
                "severity": item.severity,
                "case_number": item.case_number or "",
                "document_title": item.document_title or "",
            }
        )
    return buffer.getvalue().encode("utf-8")
