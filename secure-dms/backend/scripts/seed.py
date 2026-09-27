"""Development-only seed data. All people, emails, and the case are fictional.

Every demo account uses the same password, printed at the end of a successful run.
Do not use these credentials outside a local demonstration.
"""

import app.models  # noqa: F401
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.authorization.roles import ROLE_PERMISSIONS
from app.constants import (
    ArtifactStatus,
    ArtifactType,
    AssignmentType,
    CustodyEventType,
    FindingStatus,
    FindingType,
    ForensicRequestStatus,
    ForensicRequestType,
    CaseEventType,
    CaseStatus,
    CaseType,
    Classification,
    DocumentClassification,
    DocumentStatus,
    DocumentType,
    DocumentVersionStatus,
    EvidenceStatus,
    EvidenceType,
    RoleName,
)
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.case import Case
from app.models.case_assignment import CaseAssignment
from app.models.case_event import CaseEvent
from app.models.department import Department
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import DerivedArtifact, Evidence
from app.models.forensic import (
    ChainOfCustodyEvent,
    ForensicFinding,
    ForensicFindingArtifact,
    ForensicRequest,
    ForensicRequestEvidence,
)
from app.models.permission import Permission, RolePermission
from app.models.role import Role
from app.models.user import User

DEV_PASSWORD = "DevOnly#2026"

ROLES: list[tuple[RoleName, str]] = [
    (RoleName.ADMIN, "System administrator. Manages users and reference data."),
    (RoleName.POLICE_OFFICER, "Investigating officer assigned to cases."),
    (RoleName.POLICE_SUPERVISOR, "Supervises investigations and case assignments."),
    (RoleName.FORENSIC_EXAMINER, "Examines forensic material linked to a case."),
    (RoleName.FORENSIC_REVIEWER, "Reviews forensic findings before they are released."),
    (RoleName.PROSECUTOR, "Reviews case material for prosecution."),
    (RoleName.JUDICIAL_USER, "Reviews case material presented for judicial proceedings."),
]

DEPARTMENTS: list[tuple[str, str]] = [
    ("Administration", "ADM"),
    ("Police", "POL"),
    ("Forensic Laboratory", "FLS"),
    ("Prosecution", "PRS"),
    ("Judiciary", "JUD"),
]

USERS: list[tuple[str, str, str, RoleName, str]] = [
    ("admin1", "Demo Administrator", "admin1@example.com", RoleName.ADMIN, "ADM"),
    ("police1", "Demo Police Officer", "police1@example.com", RoleName.POLICE_OFFICER, "POL"),
    ("supervisor1", "Demo Police Supervisor", "supervisor1@example.com", RoleName.POLICE_SUPERVISOR, "POL"),
    ("forensic1", "Demo Forensic Examiner", "forensic1@example.com", RoleName.FORENSIC_EXAMINER, "FLS"),
    ("forensic_reviewer1", "Demo Forensic Reviewer", "forensic_reviewer1@example.com", RoleName.FORENSIC_REVIEWER, "FLS"),
    ("prosecutor1", "Demo Prosecutor", "prosecutor1@example.com", RoleName.PROSECUTOR, "PRS"),
    ("court1", "Demo Judicial User", "court1@example.com", RoleName.JUDICIAL_USER, "JUD"),
]

CASE_NUMBER = "CASE-2026-001"
CASE_TITLE = "Vehicle Theft Investigation"
CASE_DESCRIPTION = (
    "Fictional demonstration case. A privately owned vehicle was reported stolen from a "
    "public parking area. No real persons, registration numbers, or locations are described. "
    "The record exists so assignment and access checks can be exercised in this prototype."
)

SECOND_CASE_NUMBER = "CASE-2026-002"
SECOND_CASE_TITLE = "Cyber Fraud Investigation"
SECOND_CASE_DESCRIPTION = (
    "Fictional demonstration case. A private organisation reported unauthorised transfers "
    "from a demonstration account. No real people, account numbers, or systems are described."
)

THIRD_CASE_NUMBER = "CASE-2026-003"
THIRD_CASE_TITLE = "Burglary Investigation"
THIRD_CASE_DESCRIPTION = (
    "Fictional demonstration case. A vacant demonstration property was reported entered "
    "without permission. No real addresses or occupants are described."
)

CASES: list[tuple[str, str, str, CaseStatus]] = [
    (CASE_NUMBER, CASE_TITLE, CASE_DESCRIPTION, CaseStatus.UNDER_INVESTIGATION),
    (SECOND_CASE_NUMBER, SECOND_CASE_TITLE, SECOND_CASE_DESCRIPTION, CaseStatus.ACTIVE),
    (THIRD_CASE_NUMBER, THIRD_CASE_TITLE, THIRD_CASE_DESCRIPTION, CaseStatus.UNDER_REVIEW),
]

ASSIGNMENT_LABELS = {
    AssignmentType.PRIMARY_OFFICER: "Primary officer",
    AssignmentType.SUPERVISOR: "Supervisor",
    AssignmentType.FORENSIC_EXAMINER: "Forensic examiner",
    AssignmentType.FORENSIC_REVIEWER: "Forensic reviewer",
    AssignmentType.PROSECUTOR: "Prosecutor",
    AssignmentType.JUDICIAL_ACCESS: "Judicial access",
}

ASSIGNMENTS: list[tuple[str, str, AssignmentType]] = [
    (CASE_NUMBER, "police1", AssignmentType.PRIMARY_OFFICER),
    (CASE_NUMBER, "supervisor1", AssignmentType.SUPERVISOR),
    (CASE_NUMBER, "forensic1", AssignmentType.FORENSIC_EXAMINER),
    (CASE_NUMBER, "forensic_reviewer1", AssignmentType.FORENSIC_REVIEWER),
    (CASE_NUMBER, "prosecutor1", AssignmentType.PROSECUTOR),
    (CASE_NUMBER, "court1", AssignmentType.JUDICIAL_ACCESS),
    (SECOND_CASE_NUMBER, "police1", AssignmentType.PRIMARY_OFFICER),
    (SECOND_CASE_NUMBER, "supervisor1", AssignmentType.SUPERVISOR),
    (THIRD_CASE_NUMBER, "supervisor1", AssignmentType.SUPERVISOR),
]


def seed() -> None:
    db = SessionLocal()
    try:
        roles = _ensure_roles(db)
        departments = _ensure_departments(db)
        _ensure_permissions(db, roles)
        users = _ensure_users(db, roles, departments)
        police = departments["POL"]
        cases = {
            case_number: _ensure_case(
                db,
                users["supervisor1"],
                police,
                case_number,
                title,
                description,
                CaseType.CRIMINAL,
                status,
            )
            for case_number, title, description, status in CASES
        }
        _retire_legacy_assignments(db)
        _ensure_assignments(db, cases, users)
        _ensure_events(db, cases, users)
        _ensure_documents(db, cases, users)
        _ensure_revision_demo(db, cases, users)
        _ensure_evidence(db, cases, users)
        _ensure_forensic_requests(db, cases, users)
        _ensure_search_demo(db, cases, users)
        db.commit()
        _index_search_corpus(db)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print("Development seed complete.")
    print("Fictional accounts (development only):")
    for username, _, _, _, _ in USERS:
        print(f"  {username}")
    print(f"Shared development password: {DEV_PASSWORD}")
    print("Do not use these credentials outside local development.")


def _ensure_roles(db: Session) -> dict[str, Role]:
    roles: dict[str, Role] = {}
    for role_name, description in ROLES:
        role = db.scalar(select(Role).where(Role.name == role_name.value))
        if role is None:
            role = Role(name=role_name.value, description=description)
            db.add(role)
        else:
            role.description = description
        roles[role_name.value] = role
    db.flush()
    return roles


def _ensure_departments(db: Session) -> dict[str, Department]:
    departments: dict[str, Department] = {}
    for name, code in DEPARTMENTS:
        department = db.scalar(select(Department).where(Department.code == code))
        if department is None:
            department = Department(name=name, code=code)
            db.add(department)
        else:
            department.name = name
        departments[code] = department
    db.flush()
    return departments


def _ensure_users(
    db: Session,
    roles: dict[str, Role],
    departments: dict[str, Department],
) -> dict[str, User]:
    password_hash = hash_password(DEV_PASSWORD)
    users: dict[str, User] = {}
    for username, full_name, email, role_name, department_code in USERS:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            user = User(
                username=username,
                full_name=full_name,
                email=email,
                password_hash=password_hash,
                role_id=roles[role_name.value].id,
                department_id=departments[department_code].id,
                is_active=True,
            )
            db.add(user)
        else:
            user.full_name = full_name
            user.email = email
            user.password_hash = password_hash
            user.role_id = roles[role_name.value].id
            user.department_id = departments[department_code].id
            user.is_active = True
        users[username] = user
    db.flush()
    return users


def _ensure_permissions(db: Session, roles: dict[str, Role]) -> None:
    catalog: dict[tuple[str, str], Permission] = {}
    pairs = {pair for grants in ROLE_PERMISSIONS.values() for pair in grants}
    for resource, action in sorted(pairs, key=lambda item: (item[0].value, item[1].value)):
        permission = db.scalar(
            select(Permission).where(Permission.resource == resource.value, Permission.action == action.value)
        )
        if permission is None:
            permission = Permission(
                resource=resource.value,
                action=action.value,
                description=f"Allows {action.value} on {resource.value}.",
            )
            db.add(permission)
            db.flush()
        catalog[(resource.value, action.value)] = permission

    for role_name, grants in ROLE_PERMISSIONS.items():
        role = roles[role_name]
        wanted = {catalog[(resource.value, action.value)].id for resource, action in grants}
        links = db.scalars(select(RolePermission).where(RolePermission.role_id == role.id)).all()
        present = {link.permission_id for link in links}
        for permission_id in wanted - present:
            db.add(RolePermission(role_id=role.id, permission_id=permission_id))
        for link in links:
            if link.permission_id not in wanted:
                db.delete(link)
    db.flush()


def _ensure_case(
    db: Session,
    creator: User,
    department: Department,
    case_number: str,
    title: str,
    description: str,
    case_type: CaseType,
    status: CaseStatus,
) -> Case:
    case = db.scalar(select(Case).where(Case.case_number == case_number))
    if case is None:
        case = Case(
            case_number=case_number,
            title=title,
            description=description,
            case_type=case_type.value,
            status=status.value,
            classification=Classification.RESTRICTED.value,
            department_id=department.id,
            created_by=creator.id,
        )
        db.add(case)
        db.flush()
        db.refresh(case)
        return case
    case.title = title
    case.description = description
    case.case_type = case_type.value
    case.status = status.value
    case.classification = Classification.RESTRICTED.value
    case.department_id = department.id
    return case


def _retire_legacy_assignments(db: Session) -> None:
    legacy_rows = db.scalars(
        select(CaseAssignment).where(CaseAssignment.assignment_type == "INVESTIGATING_OFFICER")
    ).all()
    for row in legacy_rows:
        replacement = db.scalar(
            select(CaseAssignment).where(
                CaseAssignment.case_id == row.case_id,
                CaseAssignment.user_id == row.user_id,
                CaseAssignment.assignment_type == AssignmentType.PRIMARY_OFFICER.value,
            )
        )
        if replacement is None:
            row.assignment_type = AssignmentType.PRIMARY_OFFICER.value
        else:
            row.active = False
    db.flush()


def _ensure_assignments(db: Session, cases: dict[str, Case], users: dict[str, User]) -> None:
    assigner = users["admin1"]
    for case_number, username, assignment_type in ASSIGNMENTS:
        case = cases[case_number]
        existing = db.scalar(
            select(CaseAssignment).where(
                CaseAssignment.case_id == case.id,
                CaseAssignment.user_id == users[username].id,
                CaseAssignment.assignment_type == assignment_type.value,
            )
        )
        if existing is None:
            db.add(
                CaseAssignment(
                    case_id=case.id,
                    user_id=users[username].id,
                    assignment_type=assignment_type.value,
                    assigned_by=assigner.id,
                    active=True,
                )
            )
        else:
            existing.active = True
            existing.assigned_by = assigner.id
            existing.deactivated_at = None
    db.flush()


def _ensure_events(db: Session, cases: dict[str, Case], users: dict[str, User]) -> None:
    for case in cases.values():
        _ensure_event(
            db,
            case,
            CaseEventType.CASE_CREATED,
            "Case created.",
            case.created_by,
            case.created_at,
        )
    for case_number, username, assignment_type in ASSIGNMENTS:
        case = cases[case_number]
        person = users[username]
        message = f"{ASSIGNMENT_LABELS[assignment_type]} assigned: {person.full_name}."
        assignment = db.scalar(
            select(CaseAssignment).where(
                CaseAssignment.case_id == case.id,
                CaseAssignment.user_id == person.id,
                CaseAssignment.assignment_type == assignment_type.value,
            )
        )
        _ensure_event(
            db,
            case,
            CaseEventType.ASSIGNMENT_ADDED,
            message,
            case.created_by,
            assignment.assigned_at if assignment is not None else case.created_at,
        )


def _ensure_event(
    db: Session,
    case: Case,
    event_type: CaseEventType,
    message: str,
    actor_id,
    occurred_at,
) -> None:
    existing = db.scalar(
        select(CaseEvent).where(
            CaseEvent.case_id == case.id,
            CaseEvent.event_type == event_type.value,
            CaseEvent.message == message,
        )
    )
    if existing is None:
        db.add(
            CaseEvent(
                case_id=case.id,
                event_type=event_type.value,
                message=message,
                actor_id=actor_id,
                occurred_at=occurred_at,
            )
        )


def _ensure_documents(db: Session, cases: dict[str, Case], users: dict[str, User]) -> None:
    from app.services.storage_service import get_storage
    from app.services.upload_validation import sha256_hex

    case = cases.get("CASE-2026-001")
    if case is None:
        return
    stamped = datetime(2026, 9, 20, 9, 0, tzinfo=timezone.utc)
    samples = [
        (
            "DOC-2026-000001",
            "Fictional first information note",
            "Demonstration FIR text. Not a real report.",
            DocumentType.FIR,
            DocumentClassification.CONFIDENTIAL,
            DocumentStatus.APPROVED,
            "fictional-fir.pdf",
            _demo_pdf("Fictional first information note. Not a real report."),
            users["police1"],
            users["supervisor1"],
            stamped,
            None,
        ),
        (
            "DOC-2026-000002",
            "Fictional patrol note",
            "Draft working note for the demonstration case.",
            DocumentType.POLICE_REPORT,
            DocumentClassification.INTERNAL,
            DocumentStatus.DRAFT,
            "fictional-patrol-note.txt",
            b"Fictional patrol note. This draft is not an official record.\n",
            users["police1"],
            None,
            None,
            None,
        ),
        (
            "DOC-2026-000003",
            "Fictional statement summary",
            "Demonstration statement. The speaker is not a real person.",
            DocumentType.WITNESS_STATEMENT,
            DocumentClassification.CONFIDENTIAL,
            DocumentStatus.UNDER_REVIEW,
            "fictional-statement.txt",
            b"Fictional statement summary. No real witness is identified.\n",
            users["police1"],
            None,
            None,
            None,
        ),
        (
            "DOC-2026-000004",
            "Fictional investigation working record",
            "Highly confidential demonstration record.",
            DocumentType.INVESTIGATION_RECORD,
            DocumentClassification.HIGHLY_CONFIDENTIAL,
            DocumentStatus.APPROVED,
            "fictional-investigation.txt",
            b"Fictional investigation working record. Not a real case file.\n",
            users["supervisor1"],
            users["admin1"],
            stamped,
            None,
        ),
        (
            "DOC-2026-000005",
            "Fictional laboratory summary",
            "Restricted demonstration laboratory note. Not a real forensic report.",
            DocumentType.FORENSIC_REPORT,
            DocumentClassification.RESTRICTED,
            DocumentStatus.SEALED,
            "fictional-lab-summary.pdf",
            _demo_pdf("Fictional laboratory summary. Not a real forensic report."),
            users["police1"],
            users["supervisor1"],
            stamped,
            stamped,
        ),
    ]
    storage = get_storage()
    for (
        number,
        title,
        description,
        document_type,
        classification,
        status,
        filename,
        content,
        creator,
        approver,
        approved_at,
        sealed_at,
    ) in samples:
        existing = db.scalar(
            select(Document).where(Document.case_id == case.id, Document.document_number == number)
        )
        if existing is not None:
            continue
        extension = filename.rsplit(".", 1)[-1]
        mime = "application/pdf" if extension == "pdf" else "text/plain"
        stored_name, relative = storage.save_case_document(case.case_number, f".{extension}", content)
        document = Document(
            case_id=case.id,
            document_number=number,
            title=title,
            description=description,
            document_type=document_type.value,
            classification=classification.value,
            status=status.value,
            original_filename=filename,
            stored_filename=stored_name,
            storage_path=relative,
            mime_type=mime,
            file_size=len(content),
            file_hash=sha256_hex(content),
            hash_algorithm="SHA-256",
            created_by=creator.id,
            approved_by=approver.id if approver is not None else None,
            approved_at=approved_at,
            sealed_at=sealed_at,
        )
        from app.authorization.ownership import assign_document_owner

        assign_document_owner(db, document, creator.id)
        db.add(document)


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


def _ensure_revision_demo(db: Session, cases: dict[str, Case], users: dict[str, User]) -> None:
    from app.services.storage_service import get_storage
    from app.services.upload_validation import sha256_hex

    case = cases.get("CASE-2026-001")
    if case is None:
        return
    number = "DOC-2026-000006"
    police = users["police1"]
    supervisor = users["supervisor1"]
    v1_text = b"The suspect entered the building at 21:30. The courtyard was empty.\n"
    v2_text = b"The suspect entered the building at approximately 21:45. The courtyard was empty.\n"
    v3_text = b"The suspect entered the building at approximately 21:45. A witness confirmed the courtyard was empty.\n"
    storage = get_storage()
    document = db.scalar(select(Document).where(Document.case_id == case.id, Document.document_number == number))
    existing_versions = []
    if document is not None:
        existing_versions = db.scalars(select(DocumentVersion).where(DocumentVersion.document_id == document.id)).all()
    if document is not None and len(existing_versions) >= 3:
        return

    def store(version_number: int, content: bytes) -> tuple[str, str, str]:
        stored_name, relative = storage.save_document_version(case.case_number, number, version_number, ".txt", content)
        return stored_name, relative, sha256_hex(content)

    if document is None:
        stored_name, relative, digest = store(3, v3_text)
        document = Document(
            case_id=case.id,
            document_number=number,
            title="Investigation Report",
            description="Fictional investigation report used to demonstrate controlled revisions.",
            document_type=DocumentType.POLICE_REPORT.value,
            classification=DocumentClassification.INTERNAL.value,
            status=DocumentStatus.APPROVED.value,
            original_filename="investigation-report-v3.txt",
            stored_filename=stored_name,
            storage_path=relative,
            mime_type="text/plain",
            file_size=len(v3_text),
            file_hash=digest,
            hash_algorithm="SHA-256",
            created_by=police.id,
            approved_by=supervisor.id,
            approved_at=datetime(2026, 9, 26, 14, 30, tzinfo=timezone.utc),
        )
        from app.authorization.ownership import assign_document_owner

        assign_document_owner(db, document, police.id)
        db.add(document)
        db.flush()
        v3_stored = (stored_name, relative, digest)
    else:
        v3_stored = None

    def add_version(version_number, content, filename, status, summary, parent, official, approver, approved_at, comment, created_at):
        found = db.scalar(
            select(DocumentVersion).where(
                DocumentVersion.document_id == document.id,
                DocumentVersion.version_number == version_number,
            )
        )
        if found is not None:
            return found
        if version_number == 3 and v3_stored is not None:
            stored_name, relative, digest = v3_stored
        else:
            stored_name, relative, digest = store(version_number, content)
        row = DocumentVersion(
            document_id=document.id,
            version_number=version_number,
            version_label=f"v{version_number}",
            storage_path=relative,
            original_filename=filename,
            stored_filename=stored_name,
            mime_type="text/plain",
            file_size=len(content),
            sha256_hash=digest,
            hash_algorithm="SHA-256",
            created_by=police.id,
            created_at=created_at,
            status=status.value,
            change_summary=summary,
            parent_version_id=parent.id if parent is not None else None,
            is_official=official,
            approved_by=approver.id if approver is not None else None,
            approved_at=approved_at,
            review_comment=comment,
            rejected_by=supervisor.id if status == DocumentVersionStatus.REJECTED else None,
            rejected_at=datetime(2026, 9, 26, 11, 40, tzinfo=timezone.utc) if status == DocumentVersionStatus.REJECTED else None,
        )
        db.add(row)
        db.flush()
        return row

    first = add_version(
        1,
        v1_text,
        "investigation-report-v1.txt",
        DocumentVersionStatus.SUPERSEDED,
        "Initial investigation timeline.",
        None,
        False,
        supervisor,
        datetime(2026, 9, 26, 9, 30, tzinfo=timezone.utc),
        None,
        datetime(2026, 9, 26, 9, 0, tzinfo=timezone.utc),
    )
    add_version(
        2,
        v2_text,
        "investigation-report-v2.txt",
        DocumentVersionStatus.REJECTED,
        "Updated incident timeline.",
        first,
        False,
        None,
        None,
        "Clarify the timeline described in section 3.",
        datetime(2026, 9, 26, 11, 0, tzinfo=timezone.utc),
    )
    add_version(
        3,
        v3_text,
        "investigation-report-v3.txt",
        DocumentVersionStatus.APPROVED,
        "Added verified witness information.",
        first,
        True,
        supervisor,
        datetime(2026, 9, 26, 14, 30, tzinfo=timezone.utc),
        None,
        datetime(2026, 9, 26, 13, 0, tzinfo=timezone.utc),
    )
    _ensure_event(db, case, CaseEventType.DOCUMENT_REVISION_CREATED, "v1 of DOC-2026-000006 created as a draft.", police.id, datetime(2026, 9, 26, 9, 0, tzinfo=timezone.utc))
    _ensure_event(db, case, CaseEventType.DOCUMENT_REVISION_APPROVED, "v1 of DOC-2026-000006 approved as the official version.", supervisor.id, datetime(2026, 9, 26, 9, 30, tzinfo=timezone.utc))
    _ensure_event(db, case, CaseEventType.DOCUMENT_REVISION_CREATED, "v2 of DOC-2026-000006 created as a draft.", police.id, datetime(2026, 9, 26, 11, 0, tzinfo=timezone.utc))
    _ensure_event(db, case, CaseEventType.DOCUMENT_REVISION_REJECTED, "v2 of DOC-2026-000006 rejected.", supervisor.id, datetime(2026, 9, 26, 11, 40, tzinfo=timezone.utc))
    _ensure_event(db, case, CaseEventType.DOCUMENT_REVISION_CREATED, "v3 of DOC-2026-000006 created as a draft.", police.id, datetime(2026, 9, 26, 13, 0, tzinfo=timezone.utc))
    _ensure_event(db, case, CaseEventType.DOCUMENT_REVISION_APPROVED, "v3 of DOC-2026-000006 approved as the official version.", supervisor.id, datetime(2026, 9, 26, 14, 30, tzinfo=timezone.utc))


def _ensure_evidence(db: Session, cases: dict[str, Case], users: dict[str, User]) -> None:
    from app.services.storage_service import get_storage
    from app.services.upload_validation import sha256_hex

    case = cases.get("CASE-2026-001")
    if case is None:
        return
    stamped = datetime(2026, 9, 21, 10, 0, tzinfo=timezone.utc)
    storage = get_storage()
    samples = [
        (
            "EVD-2026-000001",
            "Fictional courtyard photograph",
            "Demonstration still image. Not a real scene.",
            EvidenceType.PHOTOGRAPH,
            DocumentClassification.INTERNAL,
            EvidenceStatus.RECEIVED,
            "fictional-courtyard.png",
            _demo_png(),
            "image/png",
            users["police1"],
            None,
        ),
        (
            "EVD-2026-000002",
            "Fictional interview tone",
            "Demonstration tone. No real speaker is recorded.",
            EvidenceType.AUDIO_RECORDING,
            DocumentClassification.CONFIDENTIAL,
            EvidenceStatus.VERIFIED,
            "fictional-tone.wav",
            _demo_wav(),
            "audio/wav",
            users["police1"],
            None,
        ),
        (
            "EVD-2026-000003",
            "Fictional roadside camera file",
            "Demonstration camera container. Not a real recording.",
            EvidenceType.CCTV_VIDEO,
            DocumentClassification.RESTRICTED,
            EvidenceStatus.SEALED,
            "fictional-roadside.mp4",
            _demo_mp4(),
            "video/mp4",
            users["police1"],
            stamped,
        ),
    ]
    stored_evidence: dict[str, Evidence] = {}
    for number, title, description, evidence_type, classification, status, filename, content, mime, creator, sealed_at in samples:
        existing = db.scalar(select(Evidence).where(Evidence.case_id == case.id, Evidence.evidence_number == number))
        if existing is None:
            extension = filename.rsplit(".", 1)[-1]
            stored_name, relative = storage.save_original_evidence(case.case_number, f".{extension}", content)
            existing = Evidence(
                case_id=case.id,
                evidence_number=number,
                title=title,
                description=description,
                evidence_type=evidence_type.value,
                classification=classification.value,
                status=status.value,
                original_filename=filename,
                stored_filename=stored_name,
                storage_path=relative,
                mime_type=mime,
                file_size=len(content),
                sha256_hash=sha256_hex(content),
                hash_algorithm="SHA-256",
                created_by=creator.id,
                sealed_at=sealed_at,
            )
            db.add(existing)
            db.flush()
        stored_evidence[number] = existing

    photo = stored_evidence["EVD-2026-000001"]
    crop = _ensure_artifact(
        db,
        storage,
        case,
        photo,
        None,
        "ART-2026-000001",
        "Fictional cropped still",
        "A demonstration crop of the fictional photograph.",
        ArtifactType.IMAGE_CROP,
        "Cropped the demonstration still to a smaller fictional region.",
        users["forensic1"],
        _demo_png(),
        "fictional-crop.png",
        "image/png",
    )
    _ensure_artifact(
        db,
        storage,
        case,
        photo,
        crop,
        "ART-2026-000002",
        "Fictional annotation note",
        "A demonstration note attached to the cropped still.",
        ArtifactType.ANNOTATION,
        "Added a fictional annotation to the cropped still. The original photograph was not changed.",
        users["forensic1"],
        b"Fictional annotation. This note is not the original photograph.\n",
        "fictional-annotation.txt",
        "text/plain",
    )


def _ensure_artifact(
    db: Session,
    storage,
    case: Case,
    evidence: Evidence,
    parent: Evidence | DerivedArtifact | None,
    number: str,
    title: str,
    description: str,
    artifact_type: ArtifactType,
    processing: str,
    creator: User,
    content: bytes,
    filename: str,
    mime: str,
    forensic_request_id=None,
) -> DerivedArtifact:
    from app.services.upload_validation import sha256_hex

    existing = db.scalar(
        select(DerivedArtifact).where(DerivedArtifact.case_id == case.id, DerivedArtifact.artifact_number == number)
    )
    if existing is not None:
        if forensic_request_id is not None and existing.forensic_request_id is None:
            existing.forensic_request_id = forensic_request_id
        return existing
    extension = filename.rsplit(".", 1)[-1]
    stored_name, relative = storage.save_derived_artifact(case.case_number, f".{extension}", content)
    parent_id = parent.id if isinstance(parent, DerivedArtifact) else None
    artifact = DerivedArtifact(
        case_id=case.id,
        source_evidence_id=evidence.id,
        source_artifact_id=parent_id,
        artifact_number=number,
        title=title,
        description=description,
        artifact_type=artifact_type.value,
        processing_description=processing,
        classification=evidence.classification,
        status=ArtifactStatus.RECORDED.value,
        original_filename=filename,
        stored_filename=stored_name,
        storage_path=relative,
        mime_type=mime,
        file_size=len(content),
        sha256_hash=sha256_hex(content),
        hash_algorithm="SHA-256",
        created_by=creator.id,
        forensic_request_id=forensic_request_id,
    )
    db.add(artifact)
    db.flush()
    return artifact


def _ensure_forensic_requests(db: Session, cases: dict[str, Case], users: dict[str, User]) -> None:
    from app.services.custody_service import record_event
    from app.services.storage_service import get_storage

    case = cases.get("CASE-2026-001")
    if case is None:
        return
    photo = db.scalar(select(Evidence).where(Evidence.case_id == case.id, Evidence.evidence_number == "EVD-2026-000001"))
    audio = db.scalar(select(Evidence).where(Evidence.case_id == case.id, Evidence.evidence_number == "EVD-2026-000002"))
    if photo is None or audio is None:
        return
    police = users["police1"]
    supervisor = users["supervisor1"]
    examiner = users["forensic1"]
    video = _ensure_forensic_request(
        db,
        case,
        "FR-2026-000001",
        ForensicRequestType.VIDEO_ANALYSIS,
        "Review the fictional courtyard photograph for a demonstration vehicle.",
        "Limit the examination to the courtyard photograph. Do not request the rest of the case file.",
        ForensicRequestStatus.ASSIGNED,
        police,
        supervisor,
        examiner,
        datetime(2026, 9, 26, 10, 30, tzinfo=timezone.utc),
        datetime(2026, 9, 26, 11, 0, tzinfo=timezone.utc),
        datetime(2026, 9, 26, 12, 15, tzinfo=timezone.utc),
        None,
        None,
    )
    _link_request_evidence(db, video, photo, "Analyze the fictional courtyard photograph.")
    audio_request = _ensure_forensic_request(
        db,
        case,
        "FR-2026-000002",
        ForensicRequestType.AUDIO_ANALYSIS,
        "Confirm whether the fictional interview tone is continuous.",
        "Examine only the demonstration tone. Record a factual observation and a derived note.",
        ForensicRequestStatus.SUBMITTED_FOR_REVIEW,
        police,
        supervisor,
        examiner,
        datetime(2026, 9, 26, 10, 40, tzinfo=timezone.utc),
        datetime(2026, 9, 26, 11, 10, tzinfo=timezone.utc),
        datetime(2026, 9, 26, 12, 20, tzinfo=timezone.utc),
        datetime(2026, 9, 26, 13, 0, tzinfo=timezone.utc),
        datetime(2026, 9, 26, 16, 0, tzinfo=timezone.utc),
    )
    _link_request_evidence(db, audio_request, audio, "Analyze the fictional interview tone.")
    note = _ensure_artifact(
        db,
        get_storage(),
        case,
        audio,
        None,
        "ART-2026-000003",
        "Fictional tone note",
        "A demonstration note produced from the fictional tone. The original audio was not changed.",
        ArtifactType.FORENSIC_OUTPUT,
        "Played the demonstration tone and wrote a factual note. The original file was left unchanged.",
        examiner,
        b"Fictional tone note. The original audio recording was not modified.\n",
        "fictional-tone-note.txt",
        "text/plain",
        audio_request.id,
    )
    finding = db.scalar(
        select(ForensicFinding).where(
            ForensicFinding.request_id == audio_request.id,
            ForensicFinding.finding_number == "FIND-2026-000001",
        )
    )
    if finding is None:
        finding = ForensicFinding(
            request_id=audio_request.id,
            finding_number="FIND-2026-000001",
            title="Continuous demonstration tone",
            description="The fictional recording contains a steady tone. No person is identified in the audio.",
            finding_type=FindingType.OBSERVATION.value,
            status=FindingStatus.RECORDED.value,
            created_by=examiner.id,
        )
        db.add(finding)
        db.flush()
    linked = db.scalar(
        select(ForensicFindingArtifact.id).where(
            ForensicFindingArtifact.finding_id == finding.id,
            ForensicFindingArtifact.artifact_id == note.id,
        )
    )
    if linked is None:
        db.add(ForensicFindingArtifact(finding_id=finding.id, artifact_id=note.id))

    def stamp(evidence, request, event_type, actor, when, description):
        exists = db.scalar(
            select(ChainOfCustodyEvent.id).where(
                ChainOfCustodyEvent.evidence_id == evidence.id,
                ChainOfCustodyEvent.event_type == event_type.value,
                ChainOfCustodyEvent.description == description,
            )
        )
        if exists is not None:
            return
        record_event(
            db,
            case_id=case.id,
            evidence_id=evidence.id,
            request_id=request.id if request is not None else None,
            event_type=event_type,
            performed_by=actor.id,
            description=description,
            performed_at=when,
        )

    stamp(photo, None, CustodyEventType.EVIDENCE_UPLOADED, police, datetime(2026, 9, 26, 9, 0, tzinfo=timezone.utc), "Evidence uploaded.")
    stamp(photo, None, CustodyEventType.EVIDENCE_VERIFIED, police, datetime(2026, 9, 26, 9, 3, tzinfo=timezone.utc), "Integrity verified.")
    stamp(photo, video, CustodyEventType.FORENSIC_REQUEST_CREATED, police, datetime(2026, 9, 26, 10, 30, tzinfo=timezone.utc), "Forensic examination requested (FR-2026-000001).")
    stamp(photo, video, CustodyEventType.FORENSIC_REQUEST_APPROVED, supervisor, datetime(2026, 9, 26, 11, 0, tzinfo=timezone.utc), "Forensic request FR-2026-000001 approved.")
    stamp(photo, video, CustodyEventType.FORENSIC_REQUEST_ASSIGNED, supervisor, datetime(2026, 9, 26, 12, 15, tzinfo=timezone.utc), "Forensic request FR-2026-000001 assigned to Demo Forensic Examiner.")
    stamp(audio, None, CustodyEventType.EVIDENCE_UPLOADED, police, datetime(2026, 9, 26, 9, 0, tzinfo=timezone.utc), "Evidence uploaded.")
    stamp(audio, None, CustodyEventType.EVIDENCE_VERIFIED, police, datetime(2026, 9, 26, 9, 3, tzinfo=timezone.utc), "Integrity verified.")
    stamp(audio, audio_request, CustodyEventType.FORENSIC_REQUEST_CREATED, police, datetime(2026, 9, 26, 10, 40, tzinfo=timezone.utc), "Forensic examination requested (FR-2026-000002).")
    stamp(audio, audio_request, CustodyEventType.FORENSIC_REQUEST_APPROVED, supervisor, datetime(2026, 9, 26, 11, 10, tzinfo=timezone.utc), "Forensic request FR-2026-000002 approved.")
    stamp(audio, audio_request, CustodyEventType.FORENSIC_REQUEST_ASSIGNED, supervisor, datetime(2026, 9, 26, 12, 20, tzinfo=timezone.utc), "Forensic request FR-2026-000002 assigned to Demo Forensic Examiner.")
    stamp(audio, audio_request, CustodyEventType.FORENSIC_ANALYSIS_STARTED, examiner, datetime(2026, 9, 26, 13, 0, tzinfo=timezone.utc), "Forensic analysis started for FR-2026-000002.")
    stamp(audio, audio_request, CustodyEventType.DERIVED_ARTIFACT_CREATED, examiner, datetime(2026, 9, 26, 15, 30, tzinfo=timezone.utc), "Derived artifact ART-2026-000003 created.")
    stamp(audio, audio_request, CustodyEventType.FORENSIC_REVIEW_SUBMITTED, examiner, datetime(2026, 9, 26, 16, 0, tzinfo=timezone.utc), "Forensic request FR-2026-000002 submitted for review.")


def _ensure_forensic_request(
    db: Session,
    case: Case,
    number: str,
    request_type: ForensicRequestType,
    reason: str,
    instructions: str,
    status: ForensicRequestStatus,
    requester: User,
    approver: User,
    examiner: User,
    requested_at: datetime,
    approved_at: datetime,
    assigned_at: datetime,
    started_at: datetime | None,
    submitted_at: datetime | None,
) -> ForensicRequest:
    existing = db.scalar(select(ForensicRequest).where(ForensicRequest.request_number == number))
    if existing is not None:
        return existing
    request = ForensicRequest(
        case_id=case.id,
        request_number=number,
        requested_by=requester.id,
        requested_at=requested_at,
        assigned_to=examiner.id,
        assigned_by=approver.id,
        assigned_at=assigned_at,
        request_type=request_type.value,
        reason=reason,
        instructions=instructions,
        status=status.value,
        approved_by=approver.id,
        approved_at=approved_at,
        started_by=examiner.id if started_at is not None else None,
        started_at=started_at,
        submitted_by=examiner.id if submitted_at is not None else None,
        submitted_at=submitted_at,
        created_by=requester.id,
        created_at=requested_at,
        updated_at=submitted_at or assigned_at,
    )
    db.add(request)
    db.flush()
    return request


def _link_request_evidence(db: Session, request: ForensicRequest, evidence: Evidence, purpose: str) -> None:
    existing = db.scalar(
        select(ForensicRequestEvidence.id).where(
            ForensicRequestEvidence.request_id == request.id,
            ForensicRequestEvidence.evidence_id == evidence.id,
        )
    )
    if existing is not None:
        return
    db.add(ForensicRequestEvidence(request_id=request.id, evidence_id=evidence.id, purpose=purpose))
    db.flush()


def _demo_png() -> bytes:
    import base64

    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


def _demo_wav() -> bytes:
    import struct

    samples = b"\x00\x00" * 16
    fmt = struct.pack("<HHIIHH", 1, 1, 8000, 16000, 2, 16)
    fmt_chunk = b"fmt " + struct.pack("<I", 16) + fmt
    data_chunk = b"data" + struct.pack("<I", len(samples)) + samples
    body = b"WAVE" + fmt_chunk + data_chunk
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _demo_mp4() -> bytes:
    payload = b"isom" + b"\x00\x00\x00\x00" + b"isom"
    return (8 + len(payload)).to_bytes(4, "big") + b"ftyp" + payload


def _ensure_search_demo(db: Session, cases: dict[str, Case], users: dict[str, User]) -> None:
    primary = cases.get("CASE-2026-001")
    isolated = cases.get("CASE-2026-003")
    if primary is None or isolated is None:
        return
    officer = users["police1"]
    supervisor = users["supervisor1"]
    stamped = datetime(2026, 9, 26, 16, 0, tzinfo=timezone.utc)
    samples = [
        (
            primary,
            "DOC-2026-000007",
            "FIR narrative",
            "Fictional FIR narrative for search demonstration.",
            DocumentType.FIR,
            DocumentClassification.CONFIDENTIAL,
            "fir-narrative.txt",
            "text/plain",
            (
                "FIR/2026/0042\n"
                "A red sedan bearing registration number MH-04-AB-1234 was observed near the lane.\n"
                "The incident occurred at 21:30.\n"
            ).encode(),
            officer,
        ),
        (
            primary,
            "DOC-2026-000008",
            "CCTV Description",
            "Fictional CCTV description. No real recording is attached.",
            DocumentType.EVIDENCE_RECORD,
            DocumentClassification.INTERNAL,
            "cctv-description.txt",
            "text/plain",
            b"CCTV description. The red sedan remained visible. Registration MH-04-AB-1234.\n",
            officer,
        ),
        (
            primary,
            "DOC-2026-000009",
            "Witness Statement",
            "Fictional witness statement. The speaker is not a real person.",
            DocumentType.WITNESS_STATEMENT,
            DocumentClassification.CONFIDENTIAL,
            "witness-statement.txt",
            "text/plain",
            b"A witness observed vehicle near the location after the incident.\n",
            officer,
        ),
        (
            primary,
            "DOC-2026-000010",
            "Scanned scene note",
            "Fictional scanned note. OCR is required to read it.",
            DocumentType.INVESTIGATION_RECORD,
            DocumentClassification.INTERNAL,
            "scanned-scene-note.png",
            "image/png",
            _scene_note_png(),
            officer,
        ),
        (
            isolated,
            "DOC-2026-000011",
            "Isolation note",
            "Fictional note used to check case isolation.",
            DocumentType.INVESTIGATION_RECORD,
            DocumentClassification.INTERNAL,
            "isolation-note.txt",
            "text/plain",
            b"The amber kiosk ledger appears only in this demonstration case.\n",
            supervisor,
        ),
    ]
    for case, number, title, description, document_type, classification, filename, mime, content, creator in samples:
        _ensure_official_search_document(
            db,
            case,
            creator,
            supervisor,
            number,
            title,
            description,
            document_type,
            classification,
            filename,
            mime,
            content,
            stamped,
        )


def _ensure_official_search_document(
    db: Session,
    case: Case,
    creator: User,
    approver: User,
    number: str,
    title: str,
    description: str,
    document_type: DocumentType,
    classification: DocumentClassification,
    filename: str,
    mime: str,
    content: bytes,
    stamped: datetime,
) -> None:
    from app.services.storage_service import get_storage
    from app.services.upload_validation import sha256_hex

    existing = db.scalar(select(Document).where(Document.case_id == case.id, Document.document_number == number))
    if existing is not None:
        return
    extension = "." + filename.rsplit(".", 1)[-1]
    stored_name, relative = get_storage().save_case_document(case.case_number, extension, content)
    digest = sha256_hex(content)
    document = Document(
        case_id=case.id,
        document_number=number,
        title=title,
        description=description,
        document_type=document_type.value,
        classification=classification.value,
        status=DocumentStatus.APPROVED.value,
        original_filename=filename,
        stored_filename=stored_name,
        storage_path=relative,
        mime_type=mime,
        file_size=len(content),
        file_hash=digest,
        hash_algorithm="SHA-256",
        created_by=creator.id,
        approved_by=approver.id,
        approved_at=stamped,
    )
    from app.authorization.ownership import assign_document_owner

    assign_document_owner(db, document, creator.id)
    db.add(document)
    db.flush()
    db.add(
        DocumentVersion(
            document_id=document.id,
            version_number=1,
            version_label="v1",
            storage_path=relative,
            original_filename=filename,
            stored_filename=stored_name,
            mime_type=mime,
            file_size=len(content),
            sha256_hash=digest,
            hash_algorithm="SHA-256",
            created_by=creator.id,
            status=DocumentVersionStatus.APPROVED.value,
            change_summary="Initial official version.",
            is_official=True,
            approved_by=approver.id,
            approved_at=stamped,
        )
    )
    db.flush()


def _scene_note_png() -> bytes:
    from io import BytesIO

    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1600, 320), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 42)
    except OSError:
        font = ImageFont.load_default()
    draw.text((48, 120), "Scanned note. A marigold lantern was seen beside the lane.", fill="black", font=font)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _index_search_corpus(db: Session) -> None:
    from app.models.evidence import DerivedArtifact, Evidence
    from app.services.indexing_service import index_artifact_record, index_document, index_evidence_record

    for document in db.scalars(select(Document)).all():
        index_document(db, document)
    for evidence in db.scalars(select(Evidence)).all():
        index_evidence_record(db, evidence)
    for artifact in db.scalars(select(DerivedArtifact)).all():
        index_artifact_record(db, artifact)


if __name__ == "__main__":
    seed()
