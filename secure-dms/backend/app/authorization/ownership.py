"""Which institution owns a document type. Case access does not transfer ownership."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants import DocumentType, RoleName

POLICE = "POL"
FORENSIC = "FLS"
PROSECUTION = "PRS"
COURT = "JUD"

POLICE_DOCUMENT_TYPES = frozenset(
    {
        DocumentType.FIR.value,
        DocumentType.POLICE_REPORT.value,
        DocumentType.INVESTIGATION_RECORD.value,
        DocumentType.WITNESS_STATEMENT.value,
        DocumentType.CHARGE_SHEET.value,
        DocumentType.EVIDENCE_RECORD.value,
        DocumentType.CASE_DIARY.value,
    }
)
FORENSIC_DOCUMENT_TYPES = frozenset({DocumentType.FORENSIC_REPORT.value})
PROSECUTION_DOCUMENT_TYPES = frozenset(
    {
        DocumentType.LEGAL_NOTICE.value,
        DocumentType.COURT_FILING.value,
        DocumentType.PROSECUTION_SUBMISSION.value,
    }
)
COURT_DOCUMENT_TYPES = frozenset(
    {
        DocumentType.JUDGMENT.value,
        DocumentType.COURT_ORDER.value,
        DocumentType.PROCEEDINGS.value,
    }
)

_TYPE_OWNER = {
    **{item: POLICE for item in POLICE_DOCUMENT_TYPES},
    **{item: FORENSIC for item in FORENSIC_DOCUMENT_TYPES},
    **{item: PROSECUTION for item in PROSECUTION_DOCUMENT_TYPES},
    **{item: COURT for item in COURT_DOCUMENT_TYPES},
}

_ROLE_INSTITUTION = {
    RoleName.POLICE_OFFICER.value: POLICE,
    RoleName.POLICE_SUPERVISOR.value: POLICE,
    RoleName.FORENSIC_EXAMINER.value: FORENSIC,
    RoleName.FORENSIC_REVIEWER.value: FORENSIC,
    RoleName.PROSECUTOR.value: PROSECUTION,
    RoleName.JUDICIAL_USER.value: COURT,
}

_APPROVER_ROLES = {
    POLICE: {RoleName.POLICE_SUPERVISOR.value},
    FORENSIC: {RoleName.FORENSIC_REVIEWER.value},
    PROSECUTION: {RoleName.PROSECUTOR.value},
    COURT: {RoleName.JUDICIAL_USER.value},
}


def institution_code_for_type(document_type: str | None) -> str | None:
    if document_type is None:
        return None
    return _TYPE_OWNER.get(str(document_type))


def role_institution_code(role_name: str | None) -> str | None:
    if role_name is None:
        return None
    return _ROLE_INSTITUTION.get(role_name)


def approver_roles_for_institution(code: str | None) -> set[str]:
    if code is None:
        return set()
    return set(_APPROVER_ROLES.get(code, set()))


def creatable_document_types(role_name: str | None) -> list[str]:
    code = role_institution_code(role_name)
    if code is None:
        return []
    return sorted(item for item, owner in _TYPE_OWNER.items() if owner == code)


def assign_document_owner(db: Session, document, custodian_user_id) -> None:
    """Stamp the owning department from the type. A later move of the user does not rewrite it."""
    from app.models.department import Department

    code = institution_code_for_type(getattr(document, "document_type", None))
    if code is None:
        raise ValueError("This document type has no owning institution.")
    department = db.scalar(select(Department).where(Department.code == code))
    if department is None:
        raise ValueError("The owning department is not configured.")
    document.owner_department_id = department.id
    document.custodian_user_id = custodian_user_id
