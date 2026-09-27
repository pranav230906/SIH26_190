import uuid
from typing import Literal
from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str
    type: Literal["CASE", "DOCUMENT", "EVIDENCE", "DERIVED_ARTIFACT", "FORENSIC_REQUEST", "FORENSIC_REPORT", "DOCUMENT_REVISION"]
    name: str
    status: str | None = None
    case_number: str | None = None
    date: str | None = None
    detail_url: str | None = None
    relationship_count: int = 0


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relationship: str
    explanation: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
