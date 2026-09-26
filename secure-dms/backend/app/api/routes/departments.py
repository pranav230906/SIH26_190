from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.authorization.permission_service import authorize, enforce
from app.constants import Action, ResourceType
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.department import Department
from app.models.user import User
from app.schemas.authorization import DepartmentListResponse, DepartmentRead
from app.schemas.common import ErrorResponse

router = APIRouter(prefix="/departments", tags=["Departments"])


@router.get(
    "",
    response_model=DepartmentListResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthorized"},
        403: {"model": ErrorResponse, "description": "Forbidden"},
    },
)
def list_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> DepartmentListResponse:
    enforce(authorize(current_user, Action.READ, ResourceType.DEPARTMENT))
    rows = db.scalars(select(Department).order_by(Department.code.asc())).all()
    return DepartmentListResponse(
        items=[DepartmentRead(id=row.id, name=row.name, code=row.code) for row in rows]
    )
