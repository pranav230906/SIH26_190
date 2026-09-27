import uuid
import re
from datetime import datetime
from collections import defaultdict
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.constants import Action, ResourceType
from app.authorization.permission_service import authorize
from app.models.case import Case
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import Evidence, DerivedArtifact
from app.models.forensic import ForensicRequest, ForensicFinding
from app.models.search import DocumentText
from app.models.user import User
from app.schemas.graph import GraphResponse, GraphNode, GraphEdge
from app.services.case_service import require_case


def get_relationship_graph(db: Session, user: User, case_key: str) -> GraphResponse:
    case = require_case(db, user, case_key, Action.READ)
    nodes = {}
    edges = []

    def add_node(n_id, n_type, name, status, date=None, detail_url=None):
        if n_id not in nodes:
            nodes[n_id] = GraphNode(
                id=str(n_id),
                type=n_type,
                name=name,
                status=status,
                case_number=case.case_number,
                date=date,
                detail_url=detail_url,
                relationship_count=0
            )

    def add_edge(e_id, source, target, rel, explanation):
        if str(source) in nodes and str(target) in nodes:
            edges.append(GraphEdge(
                id=e_id,
                source=str(source),
                target=str(target),
                relationship=rel,
                explanation=explanation
            ))
            nodes[str(source)].relationship_count += 1
            nodes[str(target)].relationship_count += 1

    # Add Case Node
    add_node(case.id, "CASE", f"Case {case.case_number}", case.status, case.created_at.isoformat() if case.created_at else None, f"/cases/{case.id}")

    # Documents
    docs = db.scalars(select(Document).where(Document.case_id == case.id)).all()
    auth_doc_ids = set()
    for doc in docs:
        if authorize(user, Action.READ, ResourceType.DOCUMENT, resource=doc, case=case).allowed:
            auth_doc_ids.add(doc.id)
            add_node(doc.id, "DOCUMENT", f"{doc.document_number}: {doc.title}", doc.status, doc.created_at.isoformat(), f"/documents/{doc.id}")
            add_edge(f"c-d-{doc.id}", case.id, doc.id, "CONTAINS", f"Case {case.case_number} contains document {doc.document_number}")

    # Evidence
    evidences = db.scalars(select(Evidence).where(Evidence.case_id == case.id)).all()
    auth_ev_ids = set()
    for ev in evidences:
        if authorize(user, Action.READ, ResourceType.EVIDENCE, resource=ev, case=case).allowed:
            auth_ev_ids.add(ev.id)
            add_node(ev.id, "EVIDENCE", f"{ev.evidence_number}: {ev.title}", ev.status, ev.created_at.isoformat(), f"/evidence/{ev.id}")
            add_edge(f"c-e-{ev.id}", case.id, ev.id, "CONTAINS", f"Case {case.case_number} contains evidence {ev.evidence_number}")

    # Derived Artifacts
    artifacts = db.scalars(select(DerivedArtifact).where(DerivedArtifact.case_id == case.id)).all()
    auth_art_ids = set()
    for art in artifacts:
        # Assuming if user can read evidence, they can read artifact for this demo graph logic
        # There's no separate Artifact authorization usually, it ties to evidence.
        if art.source_evidence_id in auth_ev_ids:
            auth_art_ids.add(art.id)
            add_node(art.id, "DERIVED_ARTIFACT", f"{art.artifact_number}: {art.title}", art.status, art.created_at.isoformat(), f"/artifacts/{art.id}")
            add_edge(f"e-a-{art.id}", art.source_evidence_id, art.id, "PRODUCES", f"Derived artifact {art.artifact_number} was created from evidence.")
            if art.source_artifact_id and art.source_artifact_id in auth_art_ids:
                add_edge(f"a-a-{art.id}", art.source_artifact_id, art.id, "DERIVED_FROM", "Artifact derived from another artifact.")

    # Forensic Requests
    # Filtering directly by case
    reqs = db.scalars(select(ForensicRequest).options(joinedload(ForensicRequest.evidence_links)).where(ForensicRequest.case_id == case.id)).unique().all()
    auth_req_ids = set()
    for req in reqs:
        # Check basic access
        if authorize(user, Action.READ, ResourceType.FORENSIC_REPORT, resource=req, case=case).allowed:
            # Also need to check if user can see this specific request via role. For demo we assume the authorize check is enough.
            role_name = user.role.name if user.role else None
            # Basic visibility check replicated
            visible = True
            if role_name == "FORENSIC_EXAMINER" and req.assigned_to != user.id:
                visible = False
            if role_name == "POLICE_OFFICER" and req.requested_by != user.id:
                visible = False
            
            if visible:
                auth_req_ids.add(req.id)
                add_node(req.id, "FORENSIC_REQUEST", f"{req.request_number}", req.status, req.created_at.isoformat(), f"/forensic-requests/{req.id}")
                for link in req.evidence_links:
                    if link.evidence_id in auth_ev_ids:
                        add_edge(f"e-r-{req.id}-{link.evidence_id}", link.evidence_id, req.id, "ANALYZED_BY", f"Evidence {link.evidence.evidence_number} analyzed by forensic request {req.request_number}.")

    # Link artifacts to forensic requests if applicable
    for art in artifacts:
        if art.id in auth_art_ids and art.forensic_request_id and art.forensic_request_id in auth_req_ids:
            add_edge(f"r-a-{art.id}", art.forensic_request_id, art.id, "PRODUCES", "Artifact was produced by forensic request.")

    # Forensic Findings
    findings = db.scalars(select(ForensicFinding).join(ForensicRequest).options(joinedload(ForensicFinding.artifact_links)).where(ForensicRequest.case_id == case.id)).unique().all()
    for finding in findings:
        if finding.request_id in auth_req_ids:
            # Add finding node
            add_node(finding.id, "FORENSIC_REPORT", f"{finding.finding_number}: {finding.title}", finding.status, finding.created_at.isoformat())
            add_edge(f"r-f-{finding.id}", finding.request_id, finding.id, "REPORTS", f"Finding {finding.finding_number} reported by forensic request.")
            for link in finding.artifact_links:
                if link.artifact_id in auth_art_ids:
                    add_edge(f"f-a-{finding.id}-{link.artifact_id}", finding.id, link.artifact_id, "SUPPORTS", "Finding is supported by derived artifact.")

    # Document Revisions
    versions = db.scalars(select(DocumentVersion).join(Document).where(Document.case_id == case.id)).all()
    for ver in versions:
        if ver.document_id in auth_doc_ids:
            v_id = f"ver-{ver.id}"
            add_node(v_id, "DOCUMENT_REVISION", f"v{ver.version_number}: {ver.version_label}", ver.status, ver.created_at.isoformat())
            add_edge(f"d-v-{ver.id}", ver.document_id, v_id, "HAS_REVISION", f"Document has revision v{ver.version_number}.")
            if ver.parent_version_id:
                add_edge(f"v-v-{ver.id}", f"ver-{ver.parent_version_id}", v_id, "DERIVED_FROM", "Revision is derived from previous version.")

    # Content-based Relationships
    texts = db.scalars(select(DocumentText).where(DocumentText.document_id.in_(list(auth_doc_ids)))).all()
    
    # We will search for identifiers matching [A-Z]{3}-\d{6} or similar identifiers
    identifier_pattern = re.compile(r'\b[A-Z]{3}-\d+\b')
    identifier_to_docs = defaultdict(set)
    doc_to_name = {doc.id: f"{doc.document_number}" for doc in docs}

    for text_record in texts:
        matches = identifier_pattern.findall(text_record.text)
        for match in matches:
            identifier_to_docs[match].add(text_record.document_id)
            
    for identifier, doc_ids in identifier_to_docs.items():
        doc_ids_list = list(doc_ids)
        if len(doc_ids_list) > 1:
            for i in range(len(doc_ids_list)):
                for j in range(i + 1, len(doc_ids_list)):
                    source = doc_ids_list[i]
                    target = doc_ids_list[j]
                    add_edge(
                        f"content-{identifier}-{source}-{target}",
                        source,
                        target,
                        "SHARED_IDENTIFIER",
                        f"Both documents contain identifier {identifier}."
                    )

    return GraphResponse(
        nodes=list(nodes.values()),
        edges=edges
    )
