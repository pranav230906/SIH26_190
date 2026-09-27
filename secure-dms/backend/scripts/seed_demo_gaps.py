import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.case import Case
from app.models.user import User
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import Evidence, DerivedArtifact
from app.models.forensic import ForensicRequest, ForensicRequestEvidence, ChainOfCustodyEvent
from app.models.access_request import AccessRequest
from app.models.case_event import CaseEvent
from app.constants import (
    CaseEventType, DocumentType, DocumentClassification, DocumentStatus,
    DocumentVersionStatus, EvidenceType, EvidenceStatus, ArtifactType, ArtifactStatus,
    ForensicRequestType, ForensicRequestStatus, CustodyEventType
)
from app.services.storage_service import get_storage
from app.services.upload_validation import sha256_hex
from app.authorization.ownership import assign_document_owner
from app.services.custody_service import record_event

def _demo_pdf(message: str) -> bytes:
    safe = "".join(ch if 32 <= ord(ch) < 127 and ch not in "()\\" else " " for ch in message)
    stream = f"BT /F1 16 Tf 72 720 Td ({safe}) Tj ET".encode("ascii")
    objects = [
        b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
        b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
        f"4 0 obj<< /Length {len(stream)} >>stream\n".encode("ascii") + stream + b"\nendstream\nendobj\n",
        b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    ]
    header = b"%PDF-1.4\n"
    body = bytearray()
    offsets = []
    cursor = len(header)
    for obj in objects:
        offsets.append(cursor)
        body.extend(obj)
        cursor += len(obj)
    xref = bytearray(b"xref\n0 6\n0000000000 65535 f \n")
    for offset in offsets:
        xref.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    trailer = f"trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n{cursor}\n%%EOF\n".encode("ascii")
    return header + bytes(body) + bytes(xref) + trailer

def _demo_png(text: str = "") -> bytes:
    from io import BytesIO
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new("RGB", (800, 200), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
    draw.text((20, 50), text or "Demo PNG Image", fill="black", font=font)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()

def seed_gaps():
    db = SessionLocal()
    try:
        users = {u.username: u for u in db.scalars(select(User)).all()}
        cases = {c.case_number: c for c in db.scalars(select(Case)).all()}
        storage = get_storage()
        now = datetime.now(timezone.utc)

        def add_event(case, event_type, message, actor, timestamp=None):
            db.add(CaseEvent(case_id=case.id, event_type=event_type.value, message=message, actor_id=actor.id, occurred_at=timestamp or now))

        def add_doc(case, num, title, desc, dtype, dclass, status, fname, content, creator):
            doc = db.scalar(select(Document).where(Document.case_id == case.id, Document.document_number == num))
            if doc: return doc
            ext = "." + fname.rsplit(".", 1)[-1]
            stored_name, relative = storage.save_case_document(case.case_number, ext, content)
            mime = "application/pdf" if ext == ".pdf" else "image/png" if ext == ".png" else "text/plain"
            digest = sha256_hex(content)
            doc = Document(
                case_id=case.id, document_number=num, title=title, description=desc,
                document_type=dtype.value, classification=dclass.value, status=status.value,
                original_filename=fname, stored_filename=stored_name, storage_path=relative,
                mime_type=mime, file_size=len(content), file_hash=digest, hash_algorithm="SHA-256",
                created_by=creator.id, approved_by=creator.id if status == DocumentStatus.APPROVED else None,
                approved_at=now if status == DocumentStatus.APPROVED else None
            )
            assign_document_owner(db, doc, creator.id)
            db.add(doc)
            db.flush()
            return doc

        def add_evd(case, num, title, desc, etype, dclass, status, fname, content, creator):
            evd = db.scalar(select(Evidence).where(Evidence.case_id == case.id, Evidence.evidence_number == num))
            if evd: return evd
            ext = "." + fname.rsplit(".", 1)[-1]
            stored_name, relative = storage.save_original_evidence(case.case_number, ext, content)
            mime = "image/png" if ext == ".png" else "video/mp4" if ext == ".mp4" else "application/octet-stream"
            evd = Evidence(
                case_id=case.id, evidence_number=num, title=title, description=desc,
                evidence_type=etype.value, classification=dclass.value, status=status.value,
                original_filename=fname, stored_filename=stored_name, storage_path=relative,
                mime_type=mime, file_size=len(content), sha256_hash=sha256_hex(content),
                hash_algorithm="SHA-256", created_by=creator.id, custodian_user_id=creator.id
            )
            db.add(evd)
            db.flush()
            record_event(db, case_id=case.id, evidence_id=evd.id, event_type=CustodyEventType.EVIDENCE_UPLOADED, performed_by=creator.id, description="Uploaded", performed_at=now)
            return evd

        # CASE-2026-001 Access Request
        c1 = cases.get("CASE-2026-001")
        if c1 and not db.scalar(select(AccessRequest).where(AccessRequest.case_id == c1.id, AccessRequest.status == "PENDING")):
            ar1 = AccessRequest(case_id=c1.id, requester_id=users["officer2"].id, resource_type="CASE", requested_action="READ", justification="Cross-case check", status="PENDING")
            db.add(ar1)

        # CASE-2026-002: Cyber Fraud
        c2 = cases.get("CASE-2026-002")
        if c2:
            o2 = users["officer2"]
            add_doc(c2, "DOC-2026-002-01", "FIR", "Cyber Fraud FIR", DocumentType.FIR, DocumentClassification.RESTRICTED, DocumentStatus.APPROVED, "fir.txt", b"FIR referencing TXN-998877", o2)
            add_doc(c2, "DOC-2026-002-02", "Cyber Investigation Report", "Timeline of TXN-998877", DocumentType.INVESTIGATION_RECORD, DocumentClassification.INTERNAL, DocumentStatus.DRAFT, "investigation.pdf", _demo_pdf("TXN-998877 was traced to IP 192.168.1.50 from DEVICE-MAC-01"), o2)
            add_doc(c2, "DOC-2026-002-03", "Witness Statement", "Bank Manager Statement", DocumentType.WITNESS_STATEMENT, DocumentClassification.RESTRICTED, DocumentStatus.APPROVED, "witness.txt", b"Manager confirmed TXN-998877 was unauthorized.", o2)
            add_doc(c2, "DOC-2026-002-04", "Digital Evidence Register", "List of seized devices", DocumentType.EVIDENCE_RECORD, DocumentClassification.INTERNAL, DocumentStatus.APPROVED, "register.txt", b"Seized DEVICE-MAC-01.", o2)
            add_doc(c2, "DOC-2026-002-05", "Scanned Cyber Investigation Record", "OCR Scan of device notes", DocumentType.INVESTIGATION_RECORD, DocumentClassification.INTERNAL, DocumentStatus.APPROVED, "scan.png", _demo_png("Handwritten note: Suspect used DEVICE-MAC-01 for TXN-998877"), o2)
            add_doc(c2, "DOC-2026-002-06", "Device Examination Report", "Forensic Lab analysis", DocumentType.FORENSIC_REPORT, DocumentClassification.HIGHLY_CONFIDENTIAL, DocumentStatus.APPROVED, "device.pdf", _demo_pdf("Forensic analysis of DEVICE-MAC-01 confirmed IP 192.168.1.50."), o2)
            add_doc(c2, "DOC-2026-002-07", "Investigation Summary", "Final Summary", DocumentType.POLICE_REPORT, DocumentClassification.INTERNAL, DocumentStatus.UNDER_REVIEW, "summary.txt", b"TXN-998877 is linked to DEVICE-MAC-01", o2)
            add_doc(c2, "DOC-2026-002-08", "Prosecution Note", "Legal review", DocumentType.PROSECUTION_SUBMISSION, DocumentClassification.CONFIDENTIAL, DocumentStatus.DRAFT, "prosecution.txt", b"Sufficient evidence for TXN-998877 fraud.", users["prosecutor1"])

            e2_1 = add_evd(c2, "EVD-2026-002-01", "Device Image", "Disk image of DEVICE-MAC-01", EvidenceType.DIGITAL_FILE, DocumentClassification.HIGHLY_CONFIDENTIAL, EvidenceStatus.VERIFIED, "disk.img", b"raw_disk_data", o2)
            add_evd(c2, "EVD-2026-002-02", "Transaction Record", "TXN-998877 PCAP", EvidenceType.DIGITAL_FILE, DocumentClassification.RESTRICTED, EvidenceStatus.RECEIVED, "traffic.pcap", b"pcap_data", o2)

            fr2 = db.scalar(select(ForensicRequest).where(ForensicRequest.request_number == "FR-2026-002-01"))
            if not fr2:
                fr2 = ForensicRequest(case_id=c2.id, request_number="FR-2026-002-01", requested_by=o2.id, requested_at=now, assigned_to=users["forensic1"].id, request_type=ForensicRequestType.DIGITAL_FORENSICS.value, reason="Analyze DEVICE-MAC-01", instructions="", status=ForensicRequestStatus.IN_PROGRESS.value, created_by=o2.id, created_at=now, updated_at=now)
                db.add(fr2)
                db.flush()
                db.add(ForensicRequestEvidence(request_id=fr2.id, evidence_id=e2_1.id, purpose="Disk analysis"))
                
            art2 = DerivedArtifact(
                case_id=c2.id, source_evidence_id=e2_1.id, artifact_number="ART-2026-002-01",
                title="Extracted IP Log", description="Log file from DEVICE-MAC-01", artifact_type=ArtifactType.FORENSIC_OUTPUT.value,
                processing_description="Extracted via forensic imaging tool.", classification=DocumentClassification.HIGHLY_CONFIDENTIAL.value,
                status=ArtifactStatus.RECORDED.value, original_filename="ip_log.txt", stored_filename="stored_art2.txt", storage_path="cases/CASE-2026-002/artifacts",
                mime_type="text/plain", file_size=50, sha256_hash="hash_art2", hash_algorithm="SHA-256", created_by=users["forensic1"].id,
                forensic_request_id=fr2.id
            )
            if not db.scalar(select(DerivedArtifact).where(DerivedArtifact.artifact_number == "ART-2026-002-01")):
                db.add(art2)
                
            # Access Request
            if not db.scalar(select(AccessRequest).where(AccessRequest.case_id == c2.id, AccessRequest.status == "APPROVED")):
                ar2 = AccessRequest(case_id=c2.id, requester_id=users["officer1"].id, resource_type="CASE", requested_action="READ", justification="Joint operation", status="APPROVED", reviewed_by=users["supervisor1"].id, reviewed_at=now)
                db.add(ar2)
            
            # Revision chain for DOC-2026-002-02
            doc2 = add_doc(c2, "DOC-2026-002-09", "Draft Summary", "Draft", DocumentType.POLICE_REPORT, DocumentClassification.INTERNAL, DocumentStatus.APPROVED, "draft.txt", b"draft v3", o2)
            if not db.scalar(select(DocumentVersion).where(DocumentVersion.document_id == doc2.id)):
                v1 = DocumentVersion(document_id=doc2.id, version_number=1, version_label="v1", storage_path=doc2.storage_path, original_filename="v1.txt", stored_filename="v1.txt", mime_type="text/plain", file_size=10, sha256_hash="hash1", hash_algorithm="SHA-256", created_by=o2.id, status=DocumentVersionStatus.APPROVED.value, change_summary="initial")
                db.add(v1)
                db.flush()
                v2 = DocumentVersion(document_id=doc2.id, version_number=2, version_label="v2", storage_path=doc2.storage_path, original_filename="v2.txt", stored_filename="v2.txt", mime_type="text/plain", file_size=10, sha256_hash="hash2", hash_algorithm="SHA-256", created_by=o2.id, status=DocumentVersionStatus.REJECTED.value, change_summary="rejected", parent_version_id=v1.id)
                db.add(v2)
                v3 = DocumentVersion(document_id=doc2.id, version_number=3, version_label="v3", storage_path=doc2.storage_path, original_filename="v3.txt", stored_filename="v3.txt", mime_type="text/plain", file_size=10, sha256_hash="hash3", hash_algorithm="SHA-256", created_by=o2.id, status=DocumentVersionStatus.APPROVED.value, change_summary="approved", parent_version_id=v2.id, is_official=True)
                db.add(v3)

        # CASE-2026-003: Burglary
        c3 = cases.get("CASE-2026-003")
        if c3:
            o3 = users["officer3"]
            add_doc(c3, "DOC-2026-003-01", "FIR", "Burglary FIR", DocumentType.FIR, DocumentClassification.RESTRICTED, DocumentStatus.APPROVED, "fir.txt", b"Burglary at 101 Oak St. Missing item: LAPTOP-99", o3)
            add_doc(c3, "DOC-2026-003-02", "Scene Investigation Report", "Scene report", DocumentType.INVESTIGATION_RECORD, DocumentClassification.INTERNAL, DocumentStatus.APPROVED, "scene.pdf", _demo_pdf("Window broken at 101 Oak St."), o3)
            add_doc(c3, "DOC-2026-003-03", "Scanned Witness Record", "OCR Witness", DocumentType.WITNESS_STATEMENT, DocumentClassification.CONFIDENTIAL, DocumentStatus.APPROVED, "scan3.png", _demo_png("Saw someone carrying LAPTOP-99 from 101 Oak St."), o3)
            e3_1 = add_evd(c3, "EVD-2026-003-01", "Scene Photograph", "Broken window", EvidenceType.PHOTOGRAPH, DocumentClassification.INTERNAL, EvidenceStatus.VERIFIED, "window.png", _demo_png("Window"), o3)
            
            # Access Request
            if not db.scalar(select(AccessRequest).where(AccessRequest.case_id == c3.id)):
                ar = AccessRequest(case_id=c3.id, requester_id=users["officer1"].id, resource_type="CASE", requested_action="READ", justification="Need cross-reference", status="REJECTED")
                db.add(ar)
                
            art3 = DerivedArtifact(
                case_id=c3.id, source_evidence_id=e3_1.id, artifact_number="ART-2026-003-01",
                title="Enhanced Scene Image", description="Brightness enhanced view of broken window", artifact_type=ArtifactType.IMAGE_CROP.value,
                processing_description="Brightness increased by 20%.", classification=DocumentClassification.INTERNAL.value,
                status=ArtifactStatus.RECORDED.value, original_filename="enhanced.png", stored_filename="stored_art3.png", storage_path="cases/CASE-2026-003/artifacts",
                mime_type="image/png", file_size=50, sha256_hash="hash_art3", hash_algorithm="SHA-256", created_by=users["forensic1"].id
            )
            if not db.scalar(select(DerivedArtifact).where(DerivedArtifact.artifact_number == "ART-2026-003-01")):
                db.add(art3)

        # CASE-2026-004: Digital Evidence
        c4 = cases.get("CASE-2026-004")
        if c4:
            o4 = users["officer4"]
            add_doc(c4, "DOC-2026-004-01", "FIR", "Digital Evidence FIR", DocumentType.FIR, DocumentClassification.RESTRICTED, DocumentStatus.APPROVED, "fir.txt", b"Mobile phone MOB-123 seized.", o4)
            add_doc(c4, "DOC-2026-004-02", "Scanned Digital Evidence Record", "OCR mobile report", DocumentType.INVESTIGATION_RECORD, DocumentClassification.INTERNAL, DocumentStatus.APPROVED, "scan4.png", _demo_png("MOB-123 contained suspicious files."), o4)
            e4_1 = add_evd(c4, "EVD-2026-004-01", "Mobile Extraction", "Extraction zip", EvidenceType.DIGITAL_FILE, DocumentClassification.HIGHLY_CONFIDENTIAL, EvidenceStatus.RECEIVED, "mob123.zip", b"zip_data", o4)

            fr4 = db.scalar(select(ForensicRequest).where(ForensicRequest.request_number == "FR-2026-004-01"))
            if not fr4:
                fr4 = ForensicRequest(case_id=c4.id, request_number="FR-2026-004-01", requested_by=o4.id, requested_at=now, assigned_to=users["forensic1"].id, request_type=ForensicRequestType.DIGITAL_FORENSICS.value, reason="Extract MOB-123", instructions="", status=ForensicRequestStatus.ASSIGNED.value, created_by=o4.id, created_at=now, updated_at=now)
                db.add(fr4)
                db.flush()
                db.add(ForensicRequestEvidence(request_id=fr4.id, evidence_id=e4_1.id, purpose="Extraction"))

            art4 = DerivedArtifact(
                case_id=c4.id, source_evidence_id=e4_1.id, artifact_number="ART-2026-004-01",
                title="Extracted Chat Log", description="SMS extraction from MOB-123", artifact_type=ArtifactType.FORENSIC_OUTPUT.value,
                processing_description="Extracted via mobile forensics toolkit.", classification=DocumentClassification.HIGHLY_CONFIDENTIAL.value,
                status=ArtifactStatus.RECORDED.value, original_filename="sms_log.txt", stored_filename="stored_art4.txt", storage_path="cases/CASE-2026-004/artifacts",
                mime_type="text/plain", file_size=50, sha256_hash="hash_art4", hash_algorithm="SHA-256", created_by=users["forensic1"].id,
                forensic_request_id=fr4.id
            )
            if not db.scalar(select(DerivedArtifact).where(DerivedArtifact.artifact_number == "ART-2026-004-01")):
                db.add(art4)

        from scripts.seed import _index_search_corpus
        _index_search_corpus(db)
        db.commit()
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    seed_gaps()
