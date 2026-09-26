"""Case timeline written from case and assignment changes.

This is not the cryptographic audit chain. A later audit module can replace
`list_events` without changing the case services that record these rows.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants import CaseEventType
from app.models.case_event import CaseEvent


def add_event(
    db: Session,
    *,
    case_id: uuid.UUID,
    event_type: CaseEventType,
    message: str,
    actor_id: uuid.UUID | None,
    occurred_at: datetime | None = None,
) -> CaseEvent:
    event = CaseEvent(
        case_id=case_id,
        event_type=event_type.value,
        message=message,
        actor_id=actor_id,
        occurred_at=occurred_at or datetime.now(timezone.utc),
    )
    db.add(event)
    return event


def list_events(db: Session, case_id: uuid.UUID) -> list[CaseEvent]:
    return list(
        db.scalars(
            select(CaseEvent)
            .where(CaseEvent.case_id == case_id)
            .order_by(CaseEvent.occurred_at.asc(), CaseEvent.id.asc())
        ).all()
    )
