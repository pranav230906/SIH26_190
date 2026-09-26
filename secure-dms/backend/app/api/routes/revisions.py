import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.revision import VersionDetail, VersionDiff, VersionIntegrity, VersionListResponse, VersionReviewRequest
from app.services import revision_service
from app.api.routes.documents import _file_response

router = APIRouter(tags=["Revisions"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    413: {"model": ErrorResponse, "description": "File too large"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.get("/documents/{document_id}/versions", response_model=VersionListResponse, responses=_ERRORS)
def read_versions(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionListResponse:
    items, official = revision_service.list_versions(db, current_user, document_id)
    return VersionListResponse(items=items, official_version_number=official)


@router.get("/documents/{document_id}/official-version", response_model=VersionDetail, responses=_ERRORS)
def read_official_version(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionDetail:
    return revision_service.official_version(db, current_user, document_id)


@router.post(
    "/documents/{document_id}/revisions",
    response_model=VersionDetail,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_revision(
    document_id: uuid.UUID,
    file: UploadFile = File(...),
    change_summary: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionDetail:
    return revision_service.create_revision(db, current_user, document_id, file, change_summary)


@router.get("/document-versions/{version_id}", response_model=VersionDetail, responses=_ERRORS)
def read_version(
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionDetail:
    return revision_service.get_version(db, current_user, version_id)


@router.get("/document-versions/{version_id}/diff", response_model=VersionDiff, responses=_ERRORS)
def read_diff(
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionDiff:
    return revision_service.version_diff(db, current_user, version_id)


@router.get("/document-versions/{version_id}/integrity", response_model=VersionIntegrity, responses=_ERRORS)
def read_integrity(
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionIntegrity:
    return revision_service.version_integrity(db, current_user, version_id)


@router.post("/document-versions/{version_id}/submit-review", response_model=VersionDetail, responses=_ERRORS)
def submit_version(
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionDetail:
    return revision_service.submit_version(db, current_user, version_id)


@router.post("/document-versions/{version_id}/review", response_model=VersionDetail, responses=_ERRORS)
def review_version(
    version_id: uuid.UUID,
    payload: VersionReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> VersionDetail:
    return revision_service.review_version(db, current_user, version_id, payload.decision, payload.comment)


@router.get("/document-versions/{version_id}/download", responses=_ERRORS)
def download_version(
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> FileResponse:
    version, path = revision_service.open_version_download(db, current_user, version_id)
    return _file_response(version.original_filename, version.mime_type, path, inline=False)
