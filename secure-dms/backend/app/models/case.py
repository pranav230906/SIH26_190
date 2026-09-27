import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.access_request import AccessRequest
    from app.models.case_assignment import CaseAssignment
    from app.models.case_event import CaseEvent
    from app.models.department import Department
    from app.models.document import Document
    from app.models.evidence import DerivedArtifact, Evidence
    from app.models.user import User


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    case_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("departments.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    classification: Mapped[str] = mapped_column(String(32), nullable=False, default="RESTRICTED", server_default="RESTRICTED")
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    creator: Mapped["User"] = relationship(back_populates="created_cases")
    department: Mapped["Department | None"] = relationship()
    assignments: Mapped[list["CaseAssignment"]] = relationship(back_populates="case")
    access_requests: Mapped[list["AccessRequest"]] = relationship(back_populates="case")
    events: Mapped[list["CaseEvent"]] = relationship(back_populates="case")
    documents: Mapped[list["Document"]] = relationship(back_populates="case")
    evidence_items: Mapped[list["Evidence"]] = relationship(back_populates="case")
    derived_artifacts: Mapped[list["DerivedArtifact"]] = relationship(back_populates="case")
