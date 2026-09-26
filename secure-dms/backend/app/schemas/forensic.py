import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import FindingType, ForensicRequestType, ReviewDecision
from app.schemas.evidence import ArtifactSummary


class ForensicRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_type: ForensicRequestType
    reason: str = Field(min_length=10, max_length=4000)
    instructions: str = Field(min_length=10, max_length=4000)
    evidence_ids: list[uuid.UUID] = Field(min_length=1)
    purpose: str | None = Field(default=None, max_length=2000)


class ForensicReject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=10, max_length=4000)


class ForensicAssign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    examiner_id: uuid.UUID


class ForensicFindingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=8000)
    finding_type: FindingType
    artifact_ids: list[uuid.UUID] = Field(default_factory=list)


class ForensicReviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: ReviewDecision
    comment: str | None = Field(default=None, max_length=4000)


class EvidenceRef(BaseModel):
    id: uuid.UUID
    evidence_number: str
    title: str
    evidence_type: str
    classification: str
    status: str
    sha256_hash: str
    purpose: str
    integrity_status: str | None = None


class FindingRead(BaseModel):
    id: uuid.UUID
    finding_number: str
    title: str
    description: str
    finding_type: str
    status: str
    created_by_name: str
    created_at: datetime
    artifact_ids: list[uuid.UUID]
    artifact_numbers: list[str]


class ForensicRequestSummary(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    case_number: str
    request_number: str
    request_type: str
    status: str
    requested_by_name: str
    assigned_to_name: str | None
    evidence_count: int
    requested_at: datetime
    created_at: datetime
    allowed_actions: list[str]


class ForensicRequestDetail(ForensicRequestSummary):
    case_title: str
    reason: str
    instructions: str
    requested_by: uuid.UUID
    assigned_to: uuid.UUID | None
    approved_by_name: str | None
    approved_at: datetime | None
    rejection_reason: str | None
    rejected_at: datetime | None
    started_at: datetime | None
    submitted_at: datetime | None
    reviewed_by_name: str | None
    reviewed_at: datetime | None
    review_comment: str | None
    completed_at: datetime | None
    evidence: list[EvidenceRef]
    findings: list[FindingRead]
    artifacts: list[ArtifactSummary]


class ForensicRequestListResponse(BaseModel):
    items: list[ForensicRequestSummary]


class CustodyEventRead(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    evidence_id: uuid.UUID | None
    request_id: uuid.UUID | None
    event_type: str
    performed_by: uuid.UUID
    performed_by_name: str
    performed_at: datetime
    description: str


class CustodyListResponse(BaseModel):
    items: list[CustodyEventRead]
