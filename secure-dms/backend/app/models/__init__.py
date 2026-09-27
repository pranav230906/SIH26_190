"""ORM models. Importing this package registers every table on Base.metadata."""

from app.core.database import Base
from app.models.access_request import AccessRequest
from app.models.audit_event import AuditEvent
from app.models.case import Case
from app.models.case_assignment import CaseAssignment
from app.models.case_event import CaseEvent
from app.models.court_package import CourtPackage, CourtPackageItem
from app.models.department import Department
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import DerivedArtifact, Evidence, EvidenceIntegrityEvent
from app.models.forensic import (
    ChainOfCustodyEvent,
    ForensicFinding,
    ForensicFindingArtifact,
    ForensicRequest,
    ForensicRequestEvidence,
    ForensicReview,
)
from app.models.permission import Permission, RolePermission
from app.models.rag import RagCitation, RagConversation, RagMessage
from app.models.refresh_token import RefreshToken
from app.models.search import DocumentIndexStatus, DocumentText, SearchChunk
from app.models.role import Role
from app.models.user import User

__all__ = [
    "AccessRequest",
    "AuditEvent",
    "Base",
    "Case",
    "ChainOfCustodyEvent",
    "CaseAssignment",
    "CaseEvent",
    "CourtPackage",
    "CourtPackageItem",
    "Department",
    "DocumentIndexStatus",
    "DocumentText",
    "DerivedArtifact",
    "Document",
    "DocumentVersion",
    "Evidence",
    "EvidenceIntegrityEvent",
    "Permission",
    "RagCitation",
    "RagConversation",
    "RagMessage",
    "RefreshToken",
    "Role",
    "RolePermission",
    "SearchChunk",
    "User",
]
