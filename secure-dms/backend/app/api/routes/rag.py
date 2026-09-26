import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.models.user import User
from app.schemas.common import ErrorResponse
from app.schemas.rag import (
    RagCasesResponse,
    RagConversationDetail,
    RagConversationList,
    RagQueryRequest,
    RagQueryResponse,
)
from app.services.rag_service import ask, get_conversation, list_assistant_cases, list_conversations

router = APIRouter(tags=["Case assistant"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    404: {"model": ErrorResponse, "description": "Not found"},
    422: {"model": ErrorResponse, "description": "Validation error"},
    429: {"model": ErrorResponse, "description": "Rate limited"},
    503: {"model": ErrorResponse, "description": "Unavailable"},
}


@router.get("/rag/cases", response_model=RagCasesResponse, responses=_ERRORS)
def read_rag_cases(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> RagCasesResponse:
    return list_assistant_cases(db, current_user)


@router.get("/rag/conversations", response_model=RagConversationList, responses=_ERRORS)
def read_conversations(
    case_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> RagConversationList:
    return list_conversations(db, current_user, case_id)


@router.get("/rag/conversations/{conversation_id}", response_model=RagConversationDetail, responses=_ERRORS)
def read_conversation(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> RagConversationDetail:
    return get_conversation(db, current_user, conversation_id)


@router.post("/rag/query", response_model=RagQueryResponse, responses=_ERRORS)
def query_case(
    payload: RagQueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> RagQueryResponse:
    return ask(
        db,
        current_user,
        case_id=payload.case_id,
        question=payload.question,
        conversation_id=payload.conversation_id,
    )
