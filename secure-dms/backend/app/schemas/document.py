import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import DocumentClassification, DocumentStatus, DocumentType


class DocumentSummary(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    document_number: str
    title: str
    document_type: str
    classification: str
    status: str
    original_filename: str
    created_by_name: str
    created_at: datetime
    updated_at: datetime
    allowed_status_transitions: list[str]


class DocumentDetail(DocumentSummary):
    description: str | None
    mime_type: str
    file_size: int
    file_hash: str
    hash_algorithm: str
    created_by: uuid.UUID
    approved_by: uuid.UUID | None
    approved_by_name: str | None
    approved_at: datetime | None
    sealed_at: datetime | None
    archived_at: datetime | None
    case_number: str
    case_title: str
    official_version_number: int | None = None
    official_version_label: str | None = None
    search_notice: str | None = None
    owner_department_code: str | None = None
    owner_department_name: str | None = None
    custodian_user_id: uuid.UUID | None = None
    custodian_name: str | None = None
    security_scan_message: str | None = None
    allowed_actions: list[str] = []


class DocumentTransfer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to_user_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=1000)


class DocumentListResponse(BaseModel):
    items: list[DocumentSummary]
    total: int
    page: int
    page_size: int
    max_upload_size_mb: int


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    classification: DocumentClassification | None = None


class DocumentStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: DocumentStatus
