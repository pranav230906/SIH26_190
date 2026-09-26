"""Case lifecycle statuses and operational timeline events.

Revision ID: 0003_case_lifecycle
Revises: 0002_authorization
Create Date: 2026-09-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_case_lifecycle"
down_revision: Union[str, None] = "0002_authorization"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE cases SET status = 'ACTIVE' WHERE status = 'OPEN'")
    op.execute("UPDATE cases SET status = 'UNDER_REVIEW' WHERE status = 'FORENSIC_REVIEW'")
    op.execute("UPDATE cases SET status = 'READY_FOR_PROSECUTION' WHERE status = 'PROSECUTION'")
    op.add_column("case_assignments", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "case_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name="fk_case_events_case_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], name="fk_case_events_actor_id", ondelete="SET NULL"),
    )
    op.create_index("ix_case_events_case_occurred", "case_events", ["case_id", "occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_case_events_case_occurred", table_name="case_events")
    op.drop_table("case_events")
    op.drop_column("case_assignments", "deactivated_at")
    op.execute("UPDATE cases SET status = 'OPEN' WHERE status IN ('DRAFT', 'ACTIVE')")
    op.execute("UPDATE cases SET status = 'FORENSIC_REVIEW' WHERE status = 'UNDER_REVIEW'")
    op.execute("UPDATE cases SET status = 'PROSECUTION' WHERE status IN ('READY_FOR_PROSECUTION', 'IN_COURT')")
