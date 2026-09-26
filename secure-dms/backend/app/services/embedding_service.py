"""Local embeddings. This module does not call a generative model or an external API."""

import hashlib
import logging
import math
import re

from app.core.config import get_settings

logger = logging.getLogger("secure_dms.embeddings")
_TOKEN = re.compile(r"[a-z0-9]+")
_fastembed_model = None


class EmbeddingError(Exception):
    """The configured local embedding model could not produce a vector."""


def embed_text(value: str) -> list[float]:
    settings = get_settings()
    if settings.embedding_backend == "fastembed":
        vector = _fastembed(value, settings.embedding_model, settings.embedding_dimensions)
        return vector
    return _hashed_embedding(value, settings.embedding_dimensions)


def _hashed_embedding(value: str, dimensions: int) -> list[float]:
    vector = [0.0] * dimensions
    tokens = _TOKEN.findall(value.lower())
    if not tokens:
        return vector
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[bucket] += sign
    for left, right in zip(tokens, tokens[1:]):
        digest = hashlib.sha256(f"{left}_{right}".encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[bucket] += sign * 0.5
    norm = math.sqrt(sum(item * item for item in vector)) or 1.0
    return [item / norm for item in vector]


def _fastembed(value: str, model_name: str, dimensions: int) -> list[float]:
    global _fastembed_model
    try:
        from fastembed import TextEmbedding
    except ImportError as exc:
        raise EmbeddingError("The local embedding model is not installed.") from exc
    try:
        if _fastembed_model is None:
            _fastembed_model = TextEmbedding(model_name=model_name)
        vector = next(_fastembed_model.embed([value]))
        values = [float(item) for item in vector]
    except Exception as exc:
        logger.exception("Local embedding model failed")
        raise EmbeddingError("The local embedding model could not be loaded.") from exc
    if len(values) != dimensions:
        raise EmbeddingError("The local embedding model returned an unexpected vector size.")
    return values


def cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    score = dot / (left_norm * right_norm)
    return max(0.0, min(1.0, score))
