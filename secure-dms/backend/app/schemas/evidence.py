import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class EvidenceSummary(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    evidence_number: str
    title: str
    evidence_type: str
    classification: str
    status: str
    sha256_hash: str
    hash_algorithm: str
    created_by_name: str
    created_at: datetime
    allowed_actions: list[str]


class EvidenceDetail(EvidenceSummary):
    description: str | None
    original_filename: str
    mime_type: str
    file_size: int
    created_by: uuid.UUID
    sealed_at: datetime | None
    case_number: str
    case_title: str
    last_integrity_status: str | None


class EvidenceListResponse(BaseModel):
    items: list[EvidenceSummary]
    total: int
    page: int
    page_size: int
    max_upload_size_mb: int


class IntegrityResult(BaseModel):
    evidence_id: uuid.UUID | None = None
    artifact_id: uuid.UUID | None = None
    algorithm: str
    stored_hash: str
    current_hash: str
    integrity_status: str


class ArtifactSummary(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    source_evidence_id: uuid.UUID
    source_artifact_id: uuid.UUID | None
    forensic_request_id: uuid.UUID | None = None
    artifact_number: str
    title: str
    description: str | None
    artifact_type: str
    processing_description: str
    classification: str
    status: str
    original_filename: str
    mime_type: str
    file_size: int
    sha256_hash: str
    hash_algorithm: str
    created_by_name: str
    created_at: datetime


class ProvenanceNode(BaseModel):
    id: uuid.UUID
    artifact_number: str
    title: str
    artifact_type: str
    sha256_hash: str
    hash_algorithm: str
    source_artifact_id: uuid.UUID | None
    created_by_name: str
    created_at: datetime
    children: list["ProvenanceNode"] = Field(default_factory=list)


class ProvenanceResponse(BaseModel):
    evidence_id: uuid.UUID
    evidence_number: str
    title: str
    evidence_type: str
    sha256_hash: str
    hash_algorithm: str
    status: str
    artifacts: list[ProvenanceNode]
