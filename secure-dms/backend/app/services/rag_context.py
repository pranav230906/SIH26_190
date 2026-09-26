"""Format authorized chunks for the model. Citation headers are kept intact."""

from dataclasses import dataclass

from app.core.config import get_settings


@dataclass
class ContextChunk:
    chunk_id: str
    case_id: str
    document_id: str | None
    document_title: str
    version_id: str | None
    version_label: str | None
    page_number: int | None
    source_type: str
    text: str
    score: float
    evidence_id: str | None = None
    artifact_id: str | None = None
    snippet: str = ""


def build_context(chunks: list[ContextChunk]) -> tuple[str, list[ContextChunk]]:
    settings = get_settings()
    unique: list[ContextChunk] = []
    seen: set[str] = set()
    for chunk in sorted(chunks, key=lambda item: item.score, reverse=True):
        if chunk.chunk_id in seen:
            continue
        seen.add(chunk.chunk_id)
        unique.append(chunk)
        if len(unique) >= settings.rag_top_k:
            break
    selected: list[ContextChunk] = []
    blocks: list[str] = []
    used = 0
    for index, chunk in enumerate(unique, start=1):
        header = _header(index, chunk)
        remaining = settings.max_context_chars - used - len(header)
        if remaining < 80:
            break
        body = chunk.text.strip()
        if len(body) > remaining:
            body = body[: remaining - 3].rstrip() + "..."
        block = f"{header}\n{body}\n--- END SOURCE DOCUMENT ---"
        blocks.append(block)
        selected.append(chunk)
        used += len(block)
    return "\n\n".join(blocks), selected


def _header(index: int, chunk: ContextChunk) -> str:
    page = str(chunk.page_number) if chunk.page_number else "not recorded"
    version = chunk.version_label or "not recorded"
    return (
        f"--- BEGIN SOURCE DOCUMENT ---\n"
        f"[SOURCE {index}]\n"
        f"Document: {chunk.document_title}\n"
        f"Page: {page}\n"
        f"Version: {version}\n"
        f"Source type: {chunk.source_type}\n"
        f"Text:"
    )
