import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session

from app.constants import ArtifactType, DocumentClassification, EvidenceStatus, EvidenceType
from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.evidence import (
    ArtifactSummary,
    EvidenceDetail,
    EvidenceListResponse,
    EvidenceTransfer,
    IntegrityResult,
    ProvenanceResponse,
)
from app.schemas.forensic import CustodyListResponse
from app.services.evidence_service import (
    archive_evidence,
    check_artifact_integrity,
    check_evidence_integrity,
    create_artifact_from_artifact,
    create_artifact_from_evidence,
    get_artifact,
    get_evidence,
    list_chain_of_custody,
    list_evidence,
    open_artifact_download,
    open_evidence_download,
    provenance,
    seal_evidence,
    transfer_evidence,
    upload_evidence,
    verify_status,
)

router = APIRouter(tags=["Evidence"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    413: {"model": ErrorResponse, "description": "File too large"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.get("/cases/{case_key}/evidence", response_model=EvidenceListResponse, responses=_ERRORS)
def read_case_evidence(
    case_key: str,
    evidence_type: EvidenceType | None = None,
    classification: DocumentClassification | None = None,
    status_filter: EvidenceStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceListResponse:
    items, total = list_evidence(
        db,
        current_user,
        case_key,
        evidence_type=evidence_type,
        classification=classification,
        status=status_filter,
        query=q,
        page=page,
        page_size=page_size,
    )
    return EvidenceListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        max_upload_size_mb=get_settings().max_upload_size_mb,
    )


@router.post(
    "/cases/{case_key}/evidence",
    response_model=EvidenceDetail,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_case_evidence(
    case_key: str,
    file: UploadFile = File(...),
    title: str = Form(...),
    evidence_type: EvidenceType = Form(...),
    classification: DocumentClassification = Form(...),
    description: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceDetail:
    return upload_evidence(
        db,
        current_user,
        case_key,
        file,
        title=title,
        evidence_type=evidence_type,
        classification=classification,
        description=description,
    )


@router.get("/evidence/{evidence_id}", response_model=EvidenceDetail, responses=_ERRORS)
def read_evidence(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceDetail:
    return get_evidence(db, current_user, evidence_id)


@router.get("/evidence/{evidence_id}/integrity", response_model=IntegrityResult, responses=_ERRORS)
def read_evidence_integrity(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> IntegrityResult:
    return check_evidence_integrity(db, current_user, evidence_id)


@router.get("/evidence/{evidence_id}/chain-of-custody", response_model=CustodyListResponse, responses=_ERRORS)
def read_chain_of_custody(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> CustodyListResponse:
    return CustodyListResponse(items=list_chain_of_custody(db, current_user, evidence_id))


@router.get("/evidence/{evidence_id}/download", responses=_ERRORS)
def download_evidence(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> FileResponse:
    evidence, path, temporary = open_evidence_download(db, current_user, evidence_id)
    return _file_response(evidence.original_filename, evidence.mime_type, path, temporary)


@router.get("/evidence/{evidence_id}/provenance", response_model=ProvenanceResponse, responses=_ERRORS)
def read_provenance(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ProvenanceResponse:
    return provenance(db, current_user, evidence_id)


@router.post("/evidence/{evidence_id}/verify", response_model=EvidenceDetail, responses=_ERRORS)
def mark_evidence_verified(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceDetail:
    return verify_status(db, current_user, evidence_id)


@router.post("/evidence/{evidence_id}/seal", response_model=EvidenceDetail, responses=_ERRORS)
def mark_evidence_sealed(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceDetail:
    return seal_evidence(db, current_user, evidence_id)


@router.post("/evidence/{evidence_id}/archive", response_model=EvidenceDetail, responses=_ERRORS)
def mark_evidence_archived(
    evidence_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceDetail:
    return archive_evidence(db, current_user, evidence_id)


@router.post("/evidence/{evidence_id}/transfer", response_model=EvidenceDetail, responses=_ERRORS)
def transfer_custody(
    evidence_id: uuid.UUID,
    payload: EvidenceTransfer,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> EvidenceDetail:
    return transfer_evidence(db, current_user, evidence_id, payload)


@router.post(
    "/evidence/{evidence_id}/artifacts",
    response_model=ArtifactSummary,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_artifact_from_evidence(
    evidence_id: uuid.UUID,
    file: UploadFile = File(...),
    title: str = Form(...),
    artifact_type: ArtifactType = Form(...),
    processing_description: str = Form(...),
    description: str | None = Form(default=None),
    source_artifact_id: uuid.UUID | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ArtifactSummary:
    return create_artifact_from_evidence(
        db,
        current_user,
        evidence_id,
        file,
        title=title,
        artifact_type=artifact_type,
        processing_description=processing_description,
        description=description,
        source_artifact_id=source_artifact_id,
    )


@router.get("/artifacts/{artifact_id}", response_model=ArtifactSummary, responses=_ERRORS)
def read_artifact(
    artifact_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ArtifactSummary:
    return get_artifact(db, current_user, artifact_id)


@router.get("/artifacts/{artifact_id}/integrity", response_model=IntegrityResult, responses=_ERRORS)
def read_artifact_integrity(
    artifact_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> IntegrityResult:
    return check_artifact_integrity(db, current_user, artifact_id)


@router.get("/artifacts/{artifact_id}/download", responses=_ERRORS)
def download_artifact(
    artifact_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> FileResponse:
    artifact, path, temporary = open_artifact_download(db, current_user, artifact_id)
    return _file_response(artifact.original_filename, artifact.mime_type, path, temporary)


@router.post(
    "/artifacts/{artifact_id}/artifacts",
    response_model=ArtifactSummary,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_artifact_from_artifact(
    artifact_id: uuid.UUID,
    file: UploadFile = File(...),
    title: str = Form(...),
    artifact_type: ArtifactType = Form(...),
    processing_description: str = Form(...),
    description: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> ArtifactSummary:
    return create_artifact_from_artifact(
        db,
        current_user,
        artifact_id,
        file,
        title=title,
        artifact_type=artifact_type,
        processing_description=processing_description,
        description=description,
    )


def _file_response(original_name: str, mime_type: str, path: str, temporary: bool = False) -> FileResponse:
    safe_name = Path(original_name).name.replace('"', "")
    background = BackgroundTask(Path(path).unlink, missing_ok=True) if temporary else None
    return FileResponse(
        path,
        media_type=mime_type,
        filename=safe_name,
        content_disposition_type="attachment",
        background=background,
    )
