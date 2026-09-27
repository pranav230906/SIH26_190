import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.court_package import CourtPackageCreate, CourtPackageListResponse, CourtPackageRead, CourtPackageVerification
from app.services.court_package_service import create_package, get_package, list_packages, submit_package, verify_package

router = APIRouter(tags=["Court packages"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.get("/court-packages", response_model=CourtPackageListResponse, responses=_ERRORS)
def read_packages(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CourtPackageListResponse:
    return CourtPackageListResponse(items=list_packages(db, current_user))


@router.post(
    "/cases/{case_key}/court-packages",
    response_model=CourtPackageRead,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_package(
    case_key: str,
    payload: CourtPackageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CourtPackageRead:
    return create_package(db, current_user, case_key, payload)


@router.get("/court-packages/{package_id}", response_model=CourtPackageRead, responses=_ERRORS)
def read_package(
    package_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CourtPackageRead:
    return get_package(db, current_user, package_id)


@router.post("/court-packages/{package_id}/submit", response_model=CourtPackageRead, responses=_ERRORS)
def submit(
    package_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CourtPackageRead:
    return submit_package(db, current_user, package_id)


@router.post("/court-packages/{package_id}/verify", response_model=CourtPackageVerification, responses=_ERRORS)
def verify(
    package_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CourtPackageVerification:
    return verify_package(db, current_user, package_id)
