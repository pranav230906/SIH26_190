"""Controlled document versions.

Revision ID: 0007_versions
Revises: 0006_forensics
Create Date: 2026-09-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_versions"
down_revision: Union[str, None] = "0006_forensics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("version_label", sa.String(length=16), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("hash_algorithm", sa.String(length=16), nullable=False, server_default="SHA-256"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=False),
        sa.Column("parent_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_official", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("rejected_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("version_number > 0", name="ck_document_versions_number_positive"),
        sa.CheckConstraint("parent_version_id IS NULL OR parent_version_id <> id", name="ck_document_versions_parent_not_self"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["parent_version_id"], ["document_versions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["rejected_by"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("document_id", "version_number", name="uq_document_versions_number"),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])
    op.create_index("ix_document_versions_status", "document_versions", ["status"])
    op.create_index("ix_document_versions_parent_version_id", "document_versions", ["parent_version_id"])
    op.create_index(
        "uq_document_versions_one_official",
        "document_versions",
        ["document_id"],
        unique=True,
        postgresql_where=sa.text("is_official"),
    )
    op.execute(
        """
        INSERT INTO document_versions (
            document_id, version_number, version_label, storage_path, original_filename,
            stored_filename, mime_type, file_size, sha256_hash, hash_algorithm, created_by,
            created_at, status, change_summary, is_official, approved_by, approved_at
        )
        SELECT
            id, 1, 'v1', storage_path, original_filename,
            stored_filename, mime_type, file_size, file_hash, hash_algorithm, created_by,
            created_at,
            CASE WHEN status IN ('APPROVED', 'SEALED', 'ARCHIVED') THEN 'APPROVED' ELSE 'DRAFT' END,
            'Initial version.',
            status IN ('APPROVED', 'SEALED', 'ARCHIVED'),
            CASE WHEN status IN ('APPROVED', 'SEALED', 'ARCHIVED') THEN approved_by ELSE NULL END,
            CASE WHEN status IN ('APPROVED', 'SEALED', 'ARCHIVED') THEN approved_at ELSE NULL END
        FROM documents
        """
    )


def downgrade() -> None:
    op.drop_index("uq_document_versions_one_official", table_name="document_versions")
    op.drop_index("ix_document_versions_parent_version_id", table_name="document_versions")
    op.drop_index("ix_document_versions_status", table_name="document_versions")
    op.drop_index("ix_document_versions_document_id", table_name="document_versions")
    op.drop_table("document_versions")
