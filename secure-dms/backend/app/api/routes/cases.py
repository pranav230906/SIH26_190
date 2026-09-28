import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.constants import CaseStatus, CaseType

from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.authorization import (
    AccessRequestCreate,
    AccessRequestListResponse,
    AccessRequestRead,
    AssignmentCreate,
    AssignmentListResponse,
    AssignmentRead,
)
from app.schemas.case import CaseCreate, CaseDetail, CaseListResponse, CaseUpdate
from app.schemas.common import ErrorResponse
from app.services.access_request_service import create_request, list_case_requests
from app.services.assignment_service import create_assignment, deactivate_assignment, list_assignments
from app.services.case_service import create_case, get_case, list_cases, update_case
from app.schemas.graph import GraphResponse
from app.services.graph_service import get_relationship_graph

router = APIRouter(prefix="/cases", tags=["Cases"])

_CASE_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.get("", response_model=CaseListResponse, responses=_CASE_ERRORS)
def list_visible_cases(
    status_filter: CaseStatus | None = Query(default=None, alias="status"),
    case_type: CaseType | None = None,
    department_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CaseListResponse:
    items, total = list_cases(
        db,
        current_user,
        status=status_filter,
        case_type=case_type,
        department_id=department_id,
        query=q,
        page=page,
        page_size=page_size,
    )
    return CaseListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=CaseDetail, status_code=status.HTTP_201_CREATED, responses=_CASE_ERRORS)
def create_visible_case(
    payload: CaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CaseDetail:
    return create_case(db, current_user, payload)


@router.get("/{case_key}", response_model=CaseDetail, responses=_CASE_ERRORS)
def read_case(
    case_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CaseDetail:
    return get_case(db, current_user, case_key)


@router.patch("/{case_key}", response_model=CaseDetail, responses=_CASE_ERRORS)
def patch_case(
    case_key: str,
    payload: CaseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CaseDetail:
    return update_case(db, current_user, case_key, payload)


@router.get("/{case_key}/assignments", response_model=AssignmentListResponse, responses=_CASE_ERRORS)
def read_assignments(
    case_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AssignmentListResponse:
    return AssignmentListResponse(items=list_assignments(db, current_user, case_key))


@router.post(
    "/{case_key}/assignments",
    response_model=AssignmentRead,
    status_code=status.HTTP_201_CREATED,
    responses=_CASE_ERRORS,
)
def add_assignment(
    case_key: str,
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AssignmentRead:
    return create_assignment(db, current_user, case_key, payload)


@router.delete(
    "/{case_key}/assignments/{assignment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_CASE_ERRORS,
)
def remove_assignment(
    case_key: str,
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> None:
    deactivate_assignment(db, current_user, case_key, assignment_id)


@router.get("/{case_key}/access-requests", response_model=AccessRequestListResponse, responses=_CASE_ERRORS)
def read_case_access_requests(
    case_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AccessRequestListResponse:
    return AccessRequestListResponse(items=list_case_requests(db, current_user, case_key))


@router.post(
    "/{case_key}/access-requests",
    response_model=AccessRequestRead,
    status_code=status.HTTP_201_CREATED,
    responses=_CASE_ERRORS,
)
def add_case_access_request(
    case_key: str,
    payload: AccessRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AccessRequestRead:
    return create_request(db, current_user, case_key, payload)


@router.get("/{case_key}/relationship-graph", response_model=GraphResponse, responses=_CASE_ERRORS)
def read_case_relationship_graph(
    case_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> GraphResponse:
    from app.services.audit_service import record
    from app.services.case_service import resolve_case
    case = resolve_case(db, case_key)
    if case:
        record(
            "EVIDENCE_GRAPH_VIEWED",
            user_id=current_user.id,
            case_id=case.id,
            metadata={"description": "Viewed evidence relationship graph."}
        )
    return get_relationship_graph(db, current_user, case_key)
