"""Evidence vault, derived artifacts, and integrity events.

Revision ID: 0005_evidence
Revises: 0004_documents
Create Date: 2026-09-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_evidence"
down_revision: Union[str, None] = "0004_documents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "evidence",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("evidence_number", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("evidence_type", sa.String(length=64), nullable=False),
        sa.Column("classification", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("hash_algorithm", sa.String(length=16), nullable=False, server_default="SHA-256"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("sealed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name="fk_evidence_case_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_evidence_created_by", ondelete="RESTRICT"),
        sa.UniqueConstraint("case_id", "evidence_number", name="uq_evidence_case_number"),
    )
    op.create_index("ix_evidence_case_id", "evidence", ["case_id"])
    op.create_index("ix_evidence_evidence_type", "evidence", ["evidence_type"])
    op.create_index("ix_evidence_classification", "evidence", ["classification"])
    op.create_index("ix_evidence_status", "evidence", ["status"])
    op.create_index("ix_evidence_created_at", "evidence", ["created_at"])

    op.create_table(
        "derived_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_evidence_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("artifact_number", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("artifact_type", sa.String(length=64), nullable=False),
        sa.Column("processing_description", sa.Text(), nullable=False),
        sa.Column("classification", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("hash_algorithm", sa.String(length=16), nullable=False, server_default="SHA-256"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("source_artifact_id IS NULL OR source_artifact_id <> id", name="ck_artifacts_not_self_source"),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name="fk_artifacts_case_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_evidence_id"], ["evidence.id"], name="fk_artifacts_source_evidence", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_artifact_id"], ["derived_artifacts.id"], name="fk_artifacts_source_artifact", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_artifacts_created_by", ondelete="RESTRICT"),
        sa.UniqueConstraint("case_id", "artifact_number", name="uq_artifacts_case_number"),
    )
    op.create_index("ix_derived_artifacts_case_id", "derived_artifacts", ["case_id"])
    op.create_index("ix_derived_artifacts_source_evidence_id", "derived_artifacts", ["source_evidence_id"])
    op.create_index("ix_derived_artifacts_source_artifact_id", "derived_artifacts", ["source_artifact_id"])
    op.create_index("ix_derived_artifacts_created_at", "derived_artifacts", ["created_at"])

    op.create_table(
        "evidence_integrity_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("evidence_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("stored_hash", sa.String(length=64), nullable=False),
        sa.Column("current_hash", sa.String(length=64), nullable=False),
        sa.Column("integrity_status", sa.String(length=32), nullable=False),
        sa.Column("checked_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name="fk_integrity_case_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_id"], ["evidence.id"], name="fk_integrity_evidence_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["artifact_id"], ["derived_artifacts.id"], name="fk_integrity_artifact_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["checked_by"], ["users.id"], name="fk_integrity_checked_by", ondelete="RESTRICT"),
    )


def downgrade() -> None:
    op.drop_table("evidence_integrity_events")
    op.drop_index("ix_derived_artifacts_created_at", table_name="derived_artifacts")
    op.drop_index("ix_derived_artifacts_source_artifact_id", table_name="derived_artifacts")
    op.drop_index("ix_derived_artifacts_source_evidence_id", table_name="derived_artifacts")
    op.drop_index("ix_derived_artifacts_case_id", table_name="derived_artifacts")
    op.drop_table("derived_artifacts")
    op.drop_index("ix_evidence_created_at", table_name="evidence")
    op.drop_index("ix_evidence_status", table_name="evidence")
    op.drop_index("ix_evidence_classification", table_name="evidence")
    op.drop_index("ix_evidence_evidence_type", table_name="evidence")
    op.drop_index("ix_evidence_case_id", table_name="evidence")
    op.drop_table("evidence")
