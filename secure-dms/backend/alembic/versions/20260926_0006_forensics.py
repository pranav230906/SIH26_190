"""Forensic requests, findings, reviews, and chain of custody.

Revision ID: 0006_forensics
Revises: 0005_evidence
Create Date: 2026-09-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_forensics"
down_revision: Union[str, None] = "0005_evidence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "forensic_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_number", sa.String(length=32), nullable=False),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("assigned_to", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("assigned_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("request_type", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("started_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["rejected_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["started_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("request_number", name="uq_forensic_requests_number"),
    )
    op.create_index("ix_forensic_requests_case_id", "forensic_requests", ["case_id"])
    op.create_index("ix_forensic_requests_status", "forensic_requests", ["status"])
    op.create_index("ix_forensic_requests_assigned_to", "forensic_requests", ["assigned_to"])
    op.create_index("ix_forensic_requests_requested_by", "forensic_requests", ["requested_by"])

    op.create_table(
        "forensic_request_evidence",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("evidence_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["forensic_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_id"], ["evidence.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("request_id", "evidence_id", name="uq_forensic_request_evidence"),
    )
    op.create_index("ix_forensic_request_evidence_request_id", "forensic_request_evidence", ["request_id"])
    op.create_index("ix_forensic_request_evidence_evidence_id", "forensic_request_evidence", ["evidence_id"])

    op.add_column("derived_artifacts", sa.Column("forensic_request_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_artifacts_forensic_request",
        "derived_artifacts",
        "forensic_requests",
        ["forensic_request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_derived_artifacts_forensic_request_id", "derived_artifacts", ["forensic_request_id"])

    op.create_table(
        "forensic_findings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("finding_number", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("finding_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["request_id"], ["forensic_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("request_id", "finding_number", name="uq_findings_request_number"),
    )
    op.create_index("ix_forensic_findings_request_id", "forensic_findings", ["request_id"])

    op.create_table(
        "forensic_finding_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("finding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["finding_id"], ["forensic_findings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["artifact_id"], ["derived_artifacts.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("finding_id", "artifact_id", name="uq_finding_artifact"),
    )
    op.create_index("ix_forensic_finding_artifacts_finding_id", "forensic_finding_artifacts", ["finding_id"])
    op.create_index("ix_forensic_finding_artifacts_artifact_id", "forensic_finding_artifacts", ["artifact_id"])

    op.create_table(
        "forensic_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["request_id"], ["forensic_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_forensic_reviews_request_id", "forensic_reviews", ["request_id"])

    op.create_table(
        "chain_of_custody_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("evidence_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("performed_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("performed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_id"], ["evidence.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["request_id"], ["forensic_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["performed_by"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_custody_events_case_id", "chain_of_custody_events", ["case_id"])
    op.create_index("ix_custody_events_evidence_id", "chain_of_custody_events", ["evidence_id"])
    op.create_index("ix_custody_events_request_id", "chain_of_custody_events", ["request_id"])
    op.create_index("ix_custody_events_performed_at", "chain_of_custody_events", ["performed_at"])


def downgrade() -> None:
    op.drop_table("chain_of_custody_events")
    op.drop_table("forensic_reviews")
    op.drop_table("forensic_finding_artifacts")
    op.drop_table("forensic_findings")
    op.drop_index("ix_derived_artifacts_forensic_request_id", table_name="derived_artifacts")
    op.drop_constraint("fk_artifacts_forensic_request", "derived_artifacts", type_="foreignkey")
    op.drop_column("derived_artifacts", "forensic_request_id")
    op.drop_table("forensic_request_evidence")
    op.drop_table("forensic_requests")
