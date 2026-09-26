import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RagCaseOption(BaseModel):
    id: uuid.UUID
    case_number: str
    title: str


class RagCasesResponse(BaseModel):
    cases: list[RagCaseOption]
    provider: str
    demo_mode: bool


class RagQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: uuid.UUID
    question: str = Field(min_length=1, max_length=4000)
    conversation_id: uuid.UUID | None = None


class RagCitationOut(BaseModel):
    document_id: uuid.UUID | None = None
    document_title: str
    version_id: uuid.UUID | None = None
    version_label: str | None = None
    page_number: int | None = None
    chunk_id: uuid.UUID | None = None
    evidence_id: uuid.UUID | None = None
    artifact_id: uuid.UUID | None = None
    snippet: str


class RagQueryResponse(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    case_id: uuid.UUID
    case_number: str
    answer: str
    grounding_status: str
    demo_mode: bool
    provider: str
    authorized_documents: int
    retrieved_sources: int
    citations: list[RagCitationOut]


class RagMessageOut(BaseModel):
    id: uuid.UUID
    question: str
    answer: str
    grounding_status: str
    created_at: datetime
    citations: list[RagCitationOut]


class RagConversationSummary(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    case_number: str
    created_at: datetime
    updated_at: datetime


class RagConversationDetail(RagConversationSummary):
    messages: list[RagMessageOut]


class RagConversationList(BaseModel):
    conversations: list[RagConversationSummary]
