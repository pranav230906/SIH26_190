import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.constants import SearchMode
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.search import SearchOpenRequest, SearchResponse, SearchSuggestResponse
from app.services.search_service import record_result_opened, search, suggest

router = APIRouter(tags=["Search"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.get("/search/suggest", response_model=SearchSuggestResponse, responses=_ERRORS)
def suggest_search(
    q: str = Query(min_length=1, max_length=80),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> SearchSuggestResponse:
    return suggest(db, current_user, q)


@router.get("/search/semantic", response_model=SearchResponse, responses=_ERRORS)
def semantic_search(
    q: str = Query(min_length=1, max_length=200),
    case_id: uuid.UUID | None = None,
    document_type: str | None = None,
    department_id: uuid.UUID | None = None,
    file_type: str | None = Query(default=None, max_length=128),
    date_from: date | None = None,
    date_to: date | None = None,
    match_type: str | None = None,
    include_previous: bool = False,
    include_evidence: bool = True,
    include_ocr: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> SearchResponse:
    return search(
        db,
        current_user,
        query=q,
        mode=SearchMode.SEMANTIC.value,
        case_id=case_id,
        document_type=document_type,
        department_id=department_id,
        file_type=file_type,
        date_from=date_from,
        date_to=date_to,
        match_type=match_type,
        include_previous=include_previous,
        include_evidence=include_evidence,
        include_ocr=include_ocr,
    )


@router.get("/search", response_model=SearchResponse, responses=_ERRORS)
def run_search(
    q: str = Query(min_length=1, max_length=200),
    mode: str = Query(default=SearchMode.HYBRID.value),
    case_id: uuid.UUID | None = None,
    document_type: str | None = None,
    department_id: uuid.UUID | None = None,
    file_type: str | None = Query(default=None, max_length=128),
    date_from: date | None = None,
    date_to: date | None = None,
    match_type: str | None = None,
    include_previous: bool = False,
    include_evidence: bool = True,
    include_ocr: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> SearchResponse:
    return search(
        db,
        current_user,
        query=q,
        mode=mode,
        case_id=case_id,
        document_type=document_type,
        department_id=department_id,
        file_type=file_type,
        date_from=date_from,
        date_to=date_to,
        match_type=match_type,
        include_previous=include_previous,
        include_evidence=include_evidence,
        include_ocr=include_ocr,
    )


@router.post("/search/opened", status_code=204, responses=_ERRORS)
def open_search_result(
    payload: SearchOpenRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> None:
    record_result_opened(
        db,
        current_user,
        document_id=payload.document_id,
        evidence_id=payload.evidence_id,
        artifact_id=payload.artifact_id,
    )
