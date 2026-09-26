import uuid
from datetime import datetime

from sqlalchemy import Computed, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import ARRAY, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DocumentText(Base):
    """Page-level extracted text. Search reads chunks, not these rows, on each query."""

    __tablename__ = "document_texts"
    __table_args__ = (
        UniqueConstraint("document_id", "version_id", "page_number", name="uq_document_texts_page"),
        Index("ix_document_texts_document_id", "document_id"),
        Index("ix_document_texts_version_id", "version_id"),
        Index("ix_document_texts_page_number", "page_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_versions.id", ondelete="CASCADE"), nullable=False
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    extraction_method: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_message: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class SearchChunk(Base):
    """Authorized search reads this table with case and document filters already applied."""

    __tablename__ = "search_chunks"
    __table_args__ = (
        Index("ix_search_chunks_case_id", "case_id"),
        Index("ix_search_chunks_document_id", "document_id"),
        Index("ix_search_chunks_version_id", "version_id"),
        Index("ix_search_chunks_evidence_id", "evidence_id"),
        Index("ix_search_chunks_artifact_id", "artifact_id"),
        Index("ix_search_chunks_page_number", "page_number"),
        Index("ix_search_chunks_search_vector", "search_vector", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=True
    )
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_versions.id", ondelete="CASCADE"), nullable=True
    )
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("evidence.id", ondelete="CASCADE"), nullable=True
    )
    artifact_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("derived_artifacts.id", ondelete="CASCADE"), nullable=True
    )
    source_evidence_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    extraction_method: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', coalesce(text, ''))", persisted=True),
        nullable=False,
    )
    embedding: Mapped[list[float] | None] = mapped_column(ARRAY(Float), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class DocumentIndexStatus(Base):
    __tablename__ = "document_index_status"
    __table_args__ = (UniqueConstraint("document_id", name="uq_document_index_status_document"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_versions.id", ondelete="SET NULL"), nullable=True
    )
    lexical_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", server_default="PENDING")
    semantic_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", server_default="PENDING")
    ocr_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", server_default="PENDING")
    pages_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_pages: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    extraction_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(300), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
