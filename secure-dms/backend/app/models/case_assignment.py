import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.case import Case
    from app.models.user import User


class CaseAssignment(Base):
    __tablename__ = "case_assignments"
    __table_args__ = (
        UniqueConstraint(
            "case_id",
            "user_id",
            "assignment_type",
            name="uq_case_assignments_case_user_type",
        ),
        Index("ix_case_assignments_user_active", "user_id", "active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assignment_type: Mapped[str] = mapped_column(String(64), nullable=False)
    assigned_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    case: Mapped["Case"] = relationship(back_populates="assignments")
    user: Mapped["User"] = relationship(
        back_populates="assignments",
        foreign_keys=[user_id],
    )
    assigner: Mapped["User"] = relationship(foreign_keys=[assigned_by])
