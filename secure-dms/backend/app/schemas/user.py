import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.constants import RoleName
from app.schemas.auth import DepartmentBrief, RoleBrief


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    full_name: str
    email: str
    is_active: bool
    role: RoleBrief
    department: DepartmentBrief
    created_at: datetime
    updated_at: datetime


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-z0-9_]+$")
    full_name: str = Field(min_length=3, max_length=200)
    email: str = Field(min_length=5, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)
    role_name: RoleName
    department_id: uuid.UUID

    @field_validator("username", "email", mode="before")
    @classmethod
    def _normalize_identity(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_name: RoleName | None = None
    department_id: uuid.UUID | None = None
    is_active: bool | None = None


class UserListResponse(BaseModel):
    items: list[UserRead]
