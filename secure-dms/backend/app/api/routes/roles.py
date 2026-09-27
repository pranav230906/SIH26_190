from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.authorization.permission_service import authorize, enforce
from app.authorization.roles import ROLE_PERMISSIONS
from app.constants import Action, ResourceType
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.permission import Permission, RolePermission
from app.models.role import Role
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.role import RoleListResponse, RoleRead

router = APIRouter(prefix="/roles", tags=["Roles"])

_ROLE_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
}


@router.get("", response_model=RoleListResponse, responses=_ROLE_ERRORS)
def list_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> RoleListResponse:
    enforce(authorize(current_user, Action.READ, ResourceType.ROLE))

    roles = db.scalars(
        select(Role)
        .options(joinedload(Role.permission_links).joinedload(RolePermission.permission))
        .order_by(Role.name.asc())
    ).unique().all()

    all_perms_in_db = db.scalars(
        select(Permission).order_by(Permission.resource.asc(), Permission.action.asc())
    ).all()

    all_permissions_set: set[str] = {
        f"{p.resource}.{p.action}" for p in all_perms_in_db
    }

    # Also include any defined in ROLE_PERMISSIONS
    for grants in ROLE_PERMISSIONS.values():
        for res, act in grants:
            all_permissions_set.add(f"{res.value}.{act.value}")

    all_permissions = sorted(all_permissions_set)

    role_items: list[RoleRead] = []
    for role in roles:
        perms = {
            f"{link.permission.resource}.{link.permission.action}"
            for link in role.permission_links
            if link.permission is not None
        }
        # Fallback to static mapping if database links have not yet been synchronized
        if not perms and role.name in ROLE_PERMISSIONS:
            perms = {f"{res.value}.{act.value}" for res, act in ROLE_PERMISSIONS[role.name]}

        role_items.append(
            RoleRead(
                id=role.id,
                name=role.name,
                description=role.description,
                permissions=sorted(perms),
            )
        )

    return RoleListResponse(items=role_items, all_permissions=all_permissions)
