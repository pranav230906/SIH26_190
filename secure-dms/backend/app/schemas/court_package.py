import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CourtPackageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=200)
    document_ids: list[uuid.UUID] = Field(default_factory=list)
    evidence_ids: list[uuid.UUID] = Field(default_factory=list)
    artifact_ids: list[uuid.UUID] = Field(default_factory=list)


class CourtPackageItemRead(BaseModel):
    id: uuid.UUID
    item_type: str
    label: str
    sha256_hash: str
    document_id: uuid.UUID | None
    evidence_id: uuid.UUID | None
    artifact_id: uuid.UUID | None
    snapshot: str


class CourtPackageRead(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    case_number: str
    package_number: str
    title: str
    status: str
    created_by: uuid.UUID
    created_at: datetime
    submitted_at: datetime | None
    package_hash: str | None
    seal_algorithm: str | None
    seal_value: str | None
    verification_status: str | None
    verified_at: datetime | None
    items: list[CourtPackageItemRead]


class CourtPackageListResponse(BaseModel):
    items: list[CourtPackageRead]


class CourtPackageVerification(BaseModel):
    package_id: uuid.UUID
    verification_status: str
    mismatches: list[str]
