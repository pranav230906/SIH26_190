import uuid

from fastapi import APIRouter, Body, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.authorization import (
    AccessRequestListResponse,
    AccessRequestRead,
    AccessRequestReview,
    CaseAccessRequestCreate,
)
from app.schemas.common import ErrorResponse
from app.services.access_request_service import (
    create_case_request,
    list_active_grants,
    list_my_requests,
    list_pending_reviews,
    review_request,
    revoke_request,
)

router = APIRouter(prefix="/access-requests", tags=["Access requests"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.post("/case", response_model=AccessRequestRead, status_code=status.HTTP_201_CREATED, responses=_ERRORS)
def request_case_access(
    payload: CaseAccessRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AccessRequestRead:
    return create_case_request(db, current_user, payload)


@router.get("", response_model=AccessRequestListResponse, responses=_ERRORS)
def list_access_requests(
    scope: str = Query(default="mine", pattern="^(mine|pending|active)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AccessRequestListResponse:
    if scope == "pending":
        return AccessRequestListResponse(items=list_pending_reviews(db, current_user))
    if scope == "active":
        return AccessRequestListResponse(items=list_active_grants(db, current_user))
    return AccessRequestListResponse(items=list_my_requests(db, current_user))


@router.post("/{request_id}/approve", response_model=AccessRequestRead, responses=_ERRORS)
def approve_access_request(
    request_id: uuid.UUID,
    payload: AccessRequestReview = Body(default_factory=AccessRequestReview),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AccessRequestRead:
    return review_request(db, current_user, request_id, approve=True, payload=payload)


@router.post("/{request_id}/reject", response_model=AccessRequestRead, responses=_ERRORS)
def reject_access_request(
    request_id: uuid.UUID,
    payload: AccessRequestReview = Body(default_factory=AccessRequestReview),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AccessRequestRead:
    return review_request(db, current_user, request_id, approve=False, payload=payload)


@router.post("/{request_id}/revoke", response_model=AccessRequestRead, responses=_ERRORS)
def revoke_access_grant(
    request_id: uuid.UUID,
    payload: AccessRequestReview = Body(default_factory=AccessRequestReview),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AccessRequestRead:
    return revoke_request(db, current_user, request_id, payload=payload)
