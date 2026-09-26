"""Append-only chain-of-custody events. Callers commit the surrounding transaction."""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.constants import CustodyEventType
from app.models.forensic import ChainOfCustodyEvent
from app.schemas.forensic import CustodyEventRead


def record_event(
    db: Session,
    *,
    case_id: uuid.UUID,
    event_type: CustodyEventType,
    performed_by: uuid.UUID,
    description: str,
    evidence_id: uuid.UUID | None = None,
    request_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
    performed_at: datetime | None = None,
) -> None:
    db.add(
        ChainOfCustodyEvent(
            case_id=case_id,
            evidence_id=evidence_id,
            request_id=request_id,
            event_type=event_type.value,
            performed_by=performed_by,
            performed_at=performed_at or datetime.now(timezone.utc),
            description=description,
            metadata_json=metadata,
        )
    )


def list_events(db: Session, evidence_id: uuid.UUID) -> list[CustodyEventRead]:
    rows = db.scalars(
        select(ChainOfCustodyEvent)
        .options(joinedload(ChainOfCustodyEvent.actor))
        .where(ChainOfCustodyEvent.evidence_id == evidence_id)
        .order_by(ChainOfCustodyEvent.performed_at.asc(), ChainOfCustodyEvent.id.asc())
    ).unique().all()
    return [_read(row) for row in rows]


def _read(event: ChainOfCustodyEvent) -> CustodyEventRead:
    actor = event.actor.full_name if event.actor is not None else ""
    return CustodyEventRead(
        id=event.id,
        case_id=event.case_id,
        evidence_id=event.evidence_id,
        request_id=event.request_id,
        event_type=event.event_type,
        performed_by=event.performed_by,
        performed_by_name=actor,
        performed_at=event.performed_at,
        description=event.description,
    )
