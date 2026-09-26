import uuid

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-z0-9_]+$")
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=20, max_length=4096)


class LogoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=20, max_length=4096)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RoleBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    description: str


class DepartmentBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    code: str


class MeResponse(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    role: RoleBrief
    department: DepartmentBrief
    assigned_case_ids: list[uuid.UUID]
