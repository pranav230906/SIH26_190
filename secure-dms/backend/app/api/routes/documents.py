import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.constants import DocumentClassification, DocumentStatus, DocumentType
from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.document import DocumentDetail, DocumentListResponse, DocumentStatusUpdate, DocumentUpdate
from app.schemas.search import OcrStatusResponse, PageTextResponse
from app.services.document_service import (
    change_status,
    delete_draft,
    get_document,
    list_documents,
    open_for_download,
    update_document,
    upload_document,
)

router = APIRouter(tags=["Documents"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    413: {"model": ErrorResponse, "description": "File too large"},
    415: {"model": ErrorResponse, "description": "Preview not available"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.get("/cases/{case_key}/documents", response_model=DocumentListResponse, responses=_ERRORS)
def read_case_documents(
    case_key: str,
    document_type: DocumentType | None = None,
    classification: DocumentClassification | None = None,
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> DocumentListResponse:
    items, total = list_documents(
        db,
        current_user,
        case_key,
        document_type=document_type,
        classification=classification,
        status=status_filter,
        query=q,
        page=page,
        page_size=page_size,
    )
    return DocumentListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        max_upload_size_mb=get_settings().max_upload_size_mb,
    )


@router.post(
    "/cases/{case_key}/documents",
    response_model=DocumentDetail,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
)
def add_case_document(
    case_key: str,
    file: UploadFile = File(...),
    title: str = Form(...),
    document_type: DocumentType = Form(...),
    classification: DocumentClassification = Form(...),
    description: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> DocumentDetail:
    return upload_document(
        db,
        current_user,
        case_key,
        file,
        title=title,
        document_type=document_type,
        classification=classification,
        description=description,
    )


@router.get("/documents/{document_id}", response_model=DocumentDetail, responses=_ERRORS)
def read_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> DocumentDetail:
    return get_document(db, current_user, document_id)


@router.patch("/documents/{document_id}", response_model=DocumentDetail, responses=_ERRORS)
def patch_document(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> DocumentDetail:
    return update_document(db, current_user, document_id, payload)


@router.patch("/documents/{document_id}/status", response_model=DocumentDetail, responses=_ERRORS)
def patch_document_status(
    document_id: uuid.UUID,
    payload: DocumentStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> DocumentDetail:
    return change_status(db, current_user, document_id, payload)


@router.get("/documents/{document_id}/download", responses=_ERRORS)
def download_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> FileResponse:
    filename, mime_type, path = open_for_download(db, current_user, document_id, inline=False)
    return _file_response(filename, mime_type, path, inline=False)


@router.get("/documents/{document_id}/preview", responses=_ERRORS)
def preview_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> FileResponse:
    filename, mime_type, path = open_for_download(db, current_user, document_id, inline=True)
    return _file_response(filename, mime_type, path, inline=True)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, responses=_ERRORS)
def remove_draft_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> None:
    """Admin removal of a draft only. Official records are refused."""
    delete_draft(db, current_user, document_id)


@router.get("/documents/{document_id}/ocr-status", response_model=OcrStatusResponse, responses=_ERRORS)
def read_ocr_status(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> OcrStatusResponse:
    from app.services.search_service import get_ocr_status

    return get_ocr_status(db, current_user, document_id)


@router.post("/documents/{document_id}/ocr", response_model=OcrStatusResponse, responses=_ERRORS)
def run_ocr(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> OcrStatusResponse:
    from app.services.search_service import reindex_document

    return reindex_document(db, current_user, document_id)


@router.post("/documents/{document_id}/reindex", response_model=OcrStatusResponse, responses=_ERRORS)
def reindex(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> OcrStatusResponse:
    from app.services.search_service import reindex_document

    return reindex_document(db, current_user, document_id)


@router.get("/documents/{document_id}/text", response_model=PageTextResponse, responses=_ERRORS)
def read_page_text(
    document_id: uuid.UUID,
    page: int = Query(ge=1),
    version_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> PageTextResponse:
    from app.services.search_service import get_page_text

    return get_page_text(db, current_user, document_id, page, version_id)


def _file_response(original_name: str, mime_type: str, path: str, *, inline: bool) -> FileResponse:
    safe_name = Path(original_name).name.replace('"', "")
    return FileResponse(
        path,
        media_type=mime_type,
        filename=safe_name,
        content_disposition_type="inline" if inline else "attachment",
    )
