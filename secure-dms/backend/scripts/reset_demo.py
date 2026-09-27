"""Demo Reset Script. Safely removes only demonstration records."""
import sys
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.user import User
from app.models.case import Case
from app.models.case_assignment import CaseAssignment
from app.models.case_event import CaseEvent
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import Evidence, DerivedArtifact
from app.models.forensic import ForensicRequest, ForensicFinding, ForensicFindingArtifact, ChainOfCustodyEvent, ForensicRequestEvidence
from app.models.audit_event import AuditEvent
from app.models.access_request import AccessRequest


def reset_demo_data() -> None:
    db = SessionLocal()
    try:
        # Find demo cases and demo users
        demo_cases = db.scalars(select(Case).where(Case.is_demo == True)).all()
        demo_users = db.scalars(select(User).where(User.is_demo == True)).all()

        demo_case_ids = [c.id for c in demo_cases]
        demo_user_ids = [u.id for u in demo_users]

        if not demo_case_ids and not demo_user_ids:
            print("No demo data found to reset.")
            return

        print(f"Found {len(demo_cases)} demo cases and {len(demo_users)} demo users. Removing associated records...")

        # Delete all records dependent on these cases and users
        if demo_case_ids:
            db.execute(delete(ChainOfCustodyEvent).where(ChainOfCustodyEvent.case_id.in_(demo_case_ids)))
            db.execute(delete(ForensicFindingArtifact).where(
                ForensicFindingArtifact.finding_id.in_(
                    select(ForensicFinding.id).join(ForensicRequest).where(ForensicRequest.case_id.in_(demo_case_ids))
                )
            ))
            db.execute(delete(ForensicFinding).where(
                ForensicFinding.request_id.in_(
                    select(ForensicRequest.id).where(ForensicRequest.case_id.in_(demo_case_ids))
                )
            ))
            db.execute(delete(ForensicRequestEvidence).where(
                ForensicRequestEvidence.request_id.in_(
                    select(ForensicRequest.id).where(ForensicRequest.case_id.in_(demo_case_ids))
                )
            ))
            db.execute(delete(ForensicRequest).where(ForensicRequest.case_id.in_(demo_case_ids)))
            
            db.execute(delete(DerivedArtifact).where(DerivedArtifact.case_id.in_(demo_case_ids)))
            db.execute(delete(Evidence).where(Evidence.case_id.in_(demo_case_ids)))

            db.execute(delete(DocumentVersion).where(
                DocumentVersion.document_id.in_(
                    select(Document.id).where(Document.case_id.in_(demo_case_ids))
                )
            ))
            db.execute(delete(Document).where(Document.case_id.in_(demo_case_ids)))

            db.execute(delete(CaseEvent).where(CaseEvent.case_id.in_(demo_case_ids)))
            db.execute(delete(CaseAssignment).where(CaseAssignment.case_id.in_(demo_case_ids)))
            db.execute(delete(AccessRequest).where(AccessRequest.case_id.in_(demo_case_ids)))
            db.execute(delete(Case).where(Case.id.in_(demo_case_ids)))

        # Also delete demo audit events
        if demo_user_ids:
            db.execute(delete(AuditEvent).where(AuditEvent.actor_id.in_(demo_user_ids)))
            
            # Remove assignments if any demo user had an assignment (in case they were assigned to a non-demo case)
            db.execute(delete(CaseAssignment).where(CaseAssignment.user_id.in_(demo_user_ids)))
            
            # Finally delete the demo users
            db.execute(delete(User).where(User.id.in_(demo_user_ids)))

        db.commit()
        print("Demo data reset successfully.")
    except Exception as e:
        db.rollback()
        print(f"Error resetting demo data: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    reset_demo_data()
