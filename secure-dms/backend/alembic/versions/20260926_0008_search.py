"""Document text, search chunks, and index status.

Revision ID: 0008_search
Revises: 0007_versions
Create Date: 2026-09-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_search"
down_revision: Union[str, None] = "0007_versions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_texts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("extraction_method", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_message", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["document_versions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("document_id", "version_id", "page_number", name="uq_document_texts_page"),
    )
    op.create_index("ix_document_texts_document_id", "document_texts", ["document_id"])
    op.create_index("ix_document_texts_version_id", "document_texts", ["version_id"])
    op.create_index("ix_document_texts_page_number", "document_texts", ["page_number"])

    op.create_table(
        "search_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("evidence_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_evidence_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("extraction_method", sa.String(length=32), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed("to_tsvector('simple', coalesce(text, ''))", persisted=True),
            nullable=False,
        ),
        sa.Column("embedding", postgresql.ARRAY(sa.Float()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["document_versions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_id"], ["evidence.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["artifact_id"], ["derived_artifacts.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_search_chunks_case_id", "search_chunks", ["case_id"])
    op.create_index("ix_search_chunks_document_id", "search_chunks", ["document_id"])
    op.create_index("ix_search_chunks_version_id", "search_chunks", ["version_id"])
    op.create_index("ix_search_chunks_evidence_id", "search_chunks", ["evidence_id"])
    op.create_index("ix_search_chunks_artifact_id", "search_chunks", ["artifact_id"])
    op.create_index("ix_search_chunks_page_number", "search_chunks", ["page_number"])
    op.create_index("ix_search_chunks_search_vector", "search_chunks", ["search_vector"], postgresql_using="gin")

    op.create_table(
        "document_index_status",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lexical_status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("semantic_status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("ocr_status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("pages_processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_pages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extraction_method", sa.String(length=32), nullable=True),
        sa.Column("error_message", sa.String(length=300), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["document_versions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("document_id", name="uq_document_index_status_document"),
    )


def downgrade() -> None:
    op.drop_table("document_index_status")
    op.drop_index("ix_search_chunks_search_vector", table_name="search_chunks")
    op.drop_table("search_chunks")
    op.drop_table("document_texts")
