import uuid
from datetime import datetime

from pydantic import BaseModel


class AuditEventSummary(BaseModel):
    id: uuid.UUID
    sequence: int
    event_type: str
    severity: str
    user_id: uuid.UUID | None
    user_name: str | None
    case_id: uuid.UUID | None
    case_number: str | None
    document_id: uuid.UUID | None
    document_title: str | None
    created_at: datetime
    integrity: str


class AuditEventDetail(AuditEventSummary):
    version_id: uuid.UUID | None
    evidence_id: uuid.UUID | None
    request_id: uuid.UUID | None
    ip_address: str | None
    user_agent: str | None
    metadata: dict
    previous_hash: str
    event_hash: str
    hash_algorithm: str


class AuditEventList(BaseModel):
    items: list[AuditEventSummary]
    total: int
    page: int
    page_size: int


class AuditSummary(BaseModel):
    total_events: int
    events_today: int
    security_events: int
    failed_logins: int
    access_requests: int
    system_wide: bool


class AuditStatus(BaseModel):
    status: str
    last_verified_at: datetime | None = None
    events_checked: int = 0
    failed_event_id: str | None = None
    reason: str | None = None


class AuditVerifyResult(BaseModel):
    status: str
    events_checked: int
    failed_event_id: uuid.UUID | None = None
    reason: str | None = None


class AuditExportResult(BaseModel):
    filename: str
    rows: int
