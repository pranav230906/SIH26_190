import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import CaseStatus, CaseType, Classification


class CaseDepartment(BaseModel):
    id: uuid.UUID
    name: str
    code: str


class CaseParticipant(BaseModel):
    assignment_id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    username: str
    role_name: str
    department_name: str
    department_code: str
    assignment_type: str
    assigned_at: datetime
    active: bool


class CaseTimelineEvent(BaseModel):
    id: uuid.UUID
    event_type: str
    message: str
    occurred_at: datetime


class CaseSummary(BaseModel):
    id: uuid.UUID
    case_number: str
    title: str
    case_type: str
    status: str
    classification: str
    department: CaseDepartment | None
    primary_officer_name: str | None
    created_at: datetime
    updated_at: datetime


class CaseDetail(CaseSummary):
    description: str
    created_by: uuid.UUID
    created_by_name: str
    participants: list[CaseParticipant]
    timeline: list[CaseTimelineEvent]
    allowed_status_transitions: list[str]


class CaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_number: str = Field(min_length=8, max_length=32, pattern=r"^CASE-\d{4}-\d{3,}$")
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=1, max_length=8000)
    case_type: CaseType
    department_id: uuid.UUID | None = None
    status: CaseStatus = CaseStatus.DRAFT
    classification: Classification = Classification.RESTRICTED


class CaseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, min_length=1, max_length=8000)
    status: CaseStatus | None = None
    classification: Classification | None = None
    department_id: uuid.UUID | None = None


class CaseListResponse(BaseModel):
    items: list[CaseSummary]
    total: int
    page: int
    page_size: int
