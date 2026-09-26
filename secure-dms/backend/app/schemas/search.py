import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class SearchResult(BaseModel):
    type: str
    case_id: uuid.UUID
    case_number: str
    document_id: uuid.UUID | None = None
    document_number: str | None = None
    version_id: uuid.UUID | None = None
    version_label: str | None = None
    evidence_id: uuid.UUID | None = None
    evidence_number: str | None = None
    artifact_id: uuid.UUID | None = None
    artifact_number: str | None = None
    source_evidence_id: uuid.UUID | None = None
    page_number: int | None = None
    chunk_id: uuid.UUID | None = None
    title: str
    snippet: str
    score: float
    match_type: str


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int
    mode: str
    semantic_available: bool
    message: str | None = None


class SearchSuggestion(BaseModel):
    label: str
    kind: str
    href: str


class SearchSuggestResponse(BaseModel):
    suggestions: list[SearchSuggestion]


class SearchOpenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: uuid.UUID | None = None
    evidence_id: uuid.UUID | None = None
    artifact_id: uuid.UUID | None = None


class OcrStatusResponse(BaseModel):
    status: str
    pages_processed: int
    total_pages: int
    extraction_method: str | None = None
    error: str | None = None
    lexical_status: str
    semantic_status: str
    ocr_status: str


class PageTextResponse(BaseModel):
    document_id: uuid.UUID
    version_id: uuid.UUID
    version_label: str
    page_number: int
    text: str
    extraction_method: str
    status: str


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=200)
    mode: str = "hybrid"
    case_id: uuid.UUID | None = None
    document_type: str | None = None
    department_id: uuid.UUID | None = None
    file_type: str | None = Field(default=None, max_length=128)
    date_from: date | None = None
    date_to: date | None = None
    match_type: str | None = None
    include_previous: bool = False
    include_evidence: bool = True
    include_ocr: bool = True
