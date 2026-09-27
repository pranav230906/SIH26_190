import uuid
from pydantic import BaseModel


class RoleRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    permissions: list[str]


class RoleListResponse(BaseModel):
    items: list[RoleRead]
    all_permissions: list[str]
