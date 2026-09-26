import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.authorization.permission_service import authorize, enforce
from app.constants import Action, ResourceType
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.core.exceptions import AppError
from app.core.security import hash_password
from app.models.department import Department
from app.models.role import Role
from app.models.user import User
from app.schemas.authorization import DirectoryResponse, DirectoryUser
from app.schemas.common import ErrorResponse
from app.schemas.user import UserCreate, UserListResponse, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["Users"])

_USER_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


def _load_user(db: Session, user_id: uuid.UUID) -> User | None:
    return db.scalar(
        select(User)
        .options(joinedload(User.role), joinedload(User.department))
        .where(User.id == user_id)
    )


@router.get("", response_model=UserListResponse, responses=_USER_ERRORS)
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> UserListResponse:
    enforce(authorize(current_user, Action.READ, ResourceType.USER))
    users = db.scalars(
        select(User)
        .options(joinedload(User.role), joinedload(User.department))
        .order_by(User.username.asc())
    ).unique().all()
    return UserListResponse(items=[UserRead.model_validate(user) for user in users])


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED, responses=_USER_ERRORS)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> UserRead:
    enforce(authorize(current_user, Action.CREATE, ResourceType.USER))
    role = db.scalar(select(Role).where(Role.name == payload.role_name.value))
    if role is None:
        raise AppError(422, "validation_error", "Unknown role.")
    department = db.get(Department, payload.department_id)
    if department is None:
        raise AppError(422, "validation_error", "Unknown department.")
    username = payload.username.strip().lower()
    email = payload.email.strip().lower()
    taken = db.scalar(select(User).where(or_(User.username == username, User.email == email)))
    if taken is not None:
        raise AppError(409, "conflict", "An account with this username or email already exists.")
    user = User(
        username=username,
        full_name=payload.full_name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
        role_id=role.id,
        department_id=department.id,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "conflict", "An account with this username or email already exists.") from exc
    stored = _load_user(db, user.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    from app.services.audit_service import record

    record(
        "USER_CREATED",
        user_id=current_user.id,
        metadata={"target_user_id": str(stored.id), "username": stored.username, "role": role.name},
    )
    return UserRead.model_validate(stored)


@router.get("/directory", response_model=DirectoryResponse, responses=_USER_ERRORS)
def user_directory(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> DirectoryResponse:
    can_assign = authorize(current_user, Action.ASSIGN, ResourceType.CASE).allowed
    can_read_users = authorize(current_user, Action.READ, ResourceType.USER).allowed
    if not can_assign and not can_read_users:
        enforce(authorize(current_user, Action.READ, ResourceType.USER))
    rows = db.scalars(
        select(User)
        .options(joinedload(User.role))
        .where(User.is_active.is_(True))
        .order_by(User.username.asc())
    ).unique().all()
    return DirectoryResponse(
        items=[
            DirectoryUser(
                id=row.id,
                username=row.username,
                full_name=row.full_name,
                role_name=row.role.name if row.role is not None else "",
                is_active=row.is_active,
            )
            for row in rows
        ]
    )


@router.get("/{user_id}", response_model=UserRead, responses=_USER_ERRORS)
def get_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> UserRead:
    if current_user.id != user_id:
        enforce(authorize(current_user, Action.READ, ResourceType.USER))
    user = _load_user(db, user_id)
    if user is None:
        raise AppError(404, "not_found", "User not found.")
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead, responses=_USER_ERRORS)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> UserRead:
    enforce(authorize(current_user, Action.UPDATE, ResourceType.USER))
    if payload.role_name is None and payload.department_id is None and payload.is_active is None:
        raise AppError(422, "validation_error", "Provide at least one field to update.")
    if current_user.id == user_id:
        raise AppError(403, "forbidden", "You cannot change your own account.")

    user = _load_user(db, user_id)
    if user is None:
        raise AppError(404, "not_found", "User not found.")
    if payload.role_name is not None:
        role = db.scalar(select(Role).where(Role.name == payload.role_name.value))
        if role is None:
            raise AppError(422, "validation_error", "Unknown role.")
        user.role_id = role.id
        user.role = role
    if payload.department_id is not None:
        department = db.get(Department, payload.department_id)
        if department is None:
            raise AppError(422, "validation_error", "Unknown department.")
        user.department_id = department.id
        user.department = department
    if payload.is_active is not None:
        user.is_active = payload.is_active
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    if payload.role_name is not None:
        from app.services.audit_service import record

        record(
            "USER_ROLE_CHANGED",
            user_id=current_user.id,
            metadata={"target_user_id": str(user.id), "role": payload.role_name.value},
        )
    return UserRead.model_validate(user)
