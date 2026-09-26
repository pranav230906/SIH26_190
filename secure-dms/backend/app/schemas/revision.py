import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import VersionReviewDecision


class VersionReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: VersionReviewDecision
    comment: str | None = Field(default=None, max_length=4000)


class VersionSummary(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    version_number: int
    version_label: str
    status: str
    change_summary: str
    is_official: bool
    created_by_name: str
    created_at: datetime
    approved_by_name: str | None
    approved_at: datetime | None
    review_comment: str | None
    parent_version_id: uuid.UUID | None
    parent_version_number: int | None
    sha256_hash: str
    hash_algorithm: str
    original_filename: str
    mime_type: str
    file_size: int
    allowed_actions: list[str]


class VersionDetail(VersionSummary):
    submitted_at: datetime | None
    text_excerpt: str | None


class VersionListResponse(BaseModel):
    items: list[VersionSummary]
    official_version_number: int | None


class VersionIntegrity(BaseModel):
    version_id: uuid.UUID
    algorithm: str
    stored_hash: str
    current_hash: str
    integrity_status: str


class DiffChange(BaseModel):
    type: str
    text: str


class VersionDiff(BaseModel):
    parent_version: int | None
    current_version: int
    comparable: bool
    message: str | None
    changes: list[DiffChange]
