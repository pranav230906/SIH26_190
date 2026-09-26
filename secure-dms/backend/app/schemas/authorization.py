import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import Action, AssignmentType, Classification, RequestStatus, ResourceType


class PermissionsResponse(BaseModel):
    role: str
    permissions: list[str]


class AssignmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    assignment_type: AssignmentType


class AssignmentRead(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    user_id: uuid.UUID
    username: str
    full_name: str
    role_name: str
    department_name: str
    department_code: str
    assignment_type: str
    assigned_by: uuid.UUID
    assigned_at: datetime
    active: bool


class AssignmentListResponse(BaseModel):
    items: list[AssignmentRead]


class AccessRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_type: ResourceType
    requested_action: Action
    justification: str = Field(min_length=10, max_length=4000)
    resource_id: uuid.UUID | None = None


class AccessRequestReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=2000)


class AccessRequestRead(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    case_number: str
    requester_id: uuid.UUID
    requester_username: str
    resource_type: str
    resource_id: uuid.UUID | None
    requested_action: str
    justification: str
    status: RequestStatus
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    expires_at: datetime | None
    created_at: datetime


class AccessRequestListResponse(BaseModel):
    items: list[AccessRequestRead]


class DepartmentRead(BaseModel):
    id: uuid.UUID
    name: str
    code: str


class DepartmentListResponse(BaseModel):
    items: list[DepartmentRead]


class DirectoryUser(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    role_name: str
    is_active: bool


class DirectoryResponse(BaseModel):
    items: list[DirectoryUser]
