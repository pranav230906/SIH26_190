import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.constants import ArtifactType, ForensicRequestStatus, ForensicRequestType
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.evidence import ArtifactSummary, EvidenceDetail
from app.schemas.forensic import (
    ForensicAssign,
    ForensicFindingCreate,
    ForensicReject,
    ForensicRequestCreate,
    ForensicRequestDetail,
    ForensicRequestListResponse,
    ForensicReviewCreate,
)
from app.services import forensic_service

router = APIRouter(tags=["Forensics"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    413: {"model": ErrorResponse, "description": "File too large"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.get("/forensics/work-queue", response_model=ForensicRequestListResponse, responses=_ERRORS)
def read_work_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestListResponse:
    return ForensicRequestListResponse(items=forensic_service.work_queue(db, current_user))


@router.get("/forensics/reviews", response_model=ForensicRequestListResponse, responses=_ERRORS)
def read_review_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestListResponse:
    return ForensicRequestListResponse(items=forensic_service.review_queue(db, current_user))


@router.get("/cases/{case_key}/forensic-requests", response_model=ForensicRequestListResponse, responses=_ERRORS)
def read_case_requests(
    case_key: str,
    status_filter: ForensicRequestStatus | None = Query(default=None, alias="status"),
    request_type: ForensicRequestType | None = None,
    assigned_to: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestListResponse:
    return ForensicRequestListResponse(
        items=forensic_service.list_case_requests(
            db,
            current_user,
            case_key,
            status=status_filter,
            request_type=request_type,
            assigned_to=assigned_to,
        )
    )


@router.post(
    "/cases/{case_key}/forensic-requests",
    response_model=ForensicRequestDetail,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_case_request(
    case_key: str,
    payload: ForensicRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.create_request(db, current_user, case_key, payload)


@router.get("/forensic-requests/{request_id}", response_model=ForensicRequestDetail, responses=_ERRORS)
def read_request(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.get_request(db, current_user, request_id)


@router.post("/forensic-requests/{request_id}/approve", response_model=ForensicRequestDetail, responses=_ERRORS)
def approve_request(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.approve_request(db, current_user, request_id)


@router.post("/forensic-requests/{request_id}/reject", response_model=ForensicRequestDetail, responses=_ERRORS)
def reject_request(
    request_id: uuid.UUID,
    payload: ForensicReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.reject_request(db, current_user, request_id, payload)


@router.post("/forensic-requests/{request_id}/assign", response_model=ForensicRequestDetail, responses=_ERRORS)
def assign_request(
    request_id: uuid.UUID,
    payload: ForensicAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.assign_request(db, current_user, request_id, payload)


@router.post("/forensic-requests/{request_id}/start", response_model=ForensicRequestDetail, responses=_ERRORS)
def start_request(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.start_request(db, current_user, request_id)


@router.post("/forensic-requests/{request_id}/submit-review", response_model=ForensicRequestDetail, responses=_ERRORS)
def submit_request(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.submit_review(db, current_user, request_id)


@router.post("/forensic-requests/{request_id}/review", response_model=ForensicRequestDetail, responses=_ERRORS)
def review_request(
    request_id: uuid.UUID,
    payload: ForensicReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.review_request(db, current_user, request_id, payload)


@router.get(
    "/forensic-requests/{request_id}/evidence/{evidence_id}",
    response_model=EvidenceDetail,
    responses=_ERRORS,
)
def read_requested_evidence(
    request_id: uuid.UUID,
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceDetail:
    return forensic_service.open_requested_evidence(db, current_user, request_id, evidence_id)


@router.post(
    "/forensic-requests/{request_id}/artifacts",
    response_model=ArtifactSummary,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_request_artifact(
    request_id: uuid.UUID,
    file: UploadFile = File(...),
    evidence_id: uuid.UUID = Form(...),
    title: str = Form(...),
    artifact_type: ArtifactType = Form(...),
    processing_description: str = Form(...),
    description: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ArtifactSummary:
    return forensic_service.create_request_artifact(
        db,
        current_user,
        request_id,
        file,
        evidence_id=evidence_id,
        title=title,
        artifact_type=artifact_type,
        processing_description=processing_description,
        description=description,
    )


@router.post(
    "/forensic-requests/{request_id}/findings",
    response_model=ForensicRequestDetail,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_finding(
    request_id: uuid.UUID,
    payload: ForensicFindingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ForensicRequestDetail:
    return forensic_service.add_finding(db, current_user, request_id, payload)
