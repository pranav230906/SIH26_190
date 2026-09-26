"""Environment-backed settings. Secrets are never hardcoded."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    database_url: str = Field(alias="DATABASE_URL")
    jwt_secret_key: str = Field(alias="JWT_SECRET_KEY")
    jwt_refresh_secret_key: str = Field(alias="JWT_REFRESH_SECRET_KEY")
    access_token_expire_minutes: int = Field(default=30, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=7, alias="REFRESH_TOKEN_EXPIRE_DAYS")
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="CORS_ORIGINS",
    )
    max_upload_size_mb: int = Field(default=25, alias="MAX_UPLOAD_SIZE_MB")
    search_lexical_weight: float = Field(default=0.65, alias="SEARCH_LEXICAL_WEIGHT")
    search_semantic_weight: float = Field(default=0.35, alias="SEARCH_SEMANTIC_WEIGHT")
    embedding_backend: str = Field(default="local", alias="EMBEDDING_BACKEND")
    embedding_model: str = Field(default="local-hash-v1", alias="EMBEDDING_MODEL")
    embedding_dimensions: int = Field(default=384, alias="EMBEDDING_DIMENSIONS")
    tesseract_cmd: str = Field(default="", alias="TESSERACT_CMD")
    llm_provider: str = Field(default="demo", alias="LLM_PROVIDER")
    local_llm_model: str = Field(default="", alias="LOCAL_LLM_MODEL")
    rag_top_k: int = Field(default=6, alias="RAG_TOP_K")
    max_context_chars: int = Field(default=6000, alias="MAX_CONTEXT_CHARS")
    rag_max_question_chars: int = Field(default=1000, alias="RAG_MAX_QUESTION_CHARS")
    rag_min_score: float = Field(default=0.55, alias="RAG_MIN_SCORE")
    rag_rate_limit: int = Field(default=20, alias="RAG_RATE_LIMIT")
    rag_rate_window_seconds: int = Field(default=60, alias="RAG_RATE_WINDOW_SECONDS")

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @field_validator("jwt_secret_key", "jwt_refresh_secret_key")
    @classmethod
    def validate_secret(cls, value: str) -> str:
        if len(value) < 32:
            raise ValueError("JWT secrets must be at least 32 characters.")
        if value.startswith("change-me"):
            raise ValueError("Replace placeholder JWT secrets before starting the API.")
        return value

    @field_validator("access_token_expire_minutes")
    @classmethod
    def validate_access_ttl(cls, value: int) -> int:
        if value < 1 or value > 24 * 60:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be between 1 and 1440.")
        return value

    @field_validator("max_upload_size_mb")
    @classmethod
    def validate_upload_limit(cls, value: int) -> int:
        if value < 1 or value > 100:
            raise ValueError("MAX_UPLOAD_SIZE_MB must be between 1 and 100.")
        return value

    @field_validator("search_lexical_weight", "search_semantic_weight")
    @classmethod
    def validate_search_weight(cls, value: float) -> float:
        if value < 0 or value > 1:
            raise ValueError("Search weights must be between 0 and 1.")
        return value

    @field_validator("embedding_backend")
    @classmethod
    def validate_embedding_backend(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if cleaned not in {"local", "fastembed"}:
            raise ValueError("EMBEDDING_BACKEND must be local or fastembed.")
        return cleaned

    @field_validator("embedding_dimensions")
    @classmethod
    def validate_embedding_dimensions(cls, value: int) -> int:
        if value < 32 or value > 1024:
            raise ValueError("EMBEDDING_DIMENSIONS must be between 32 and 1024.")
        return value

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if cleaned not in {"demo", "local"}:
            raise ValueError("LLM_PROVIDER must be demo or local.")
        return cleaned

    @field_validator("rag_top_k")
    @classmethod
    def validate_rag_top_k(cls, value: int) -> int:
        if value < 1 or value > 20:
            raise ValueError("RAG_TOP_K must be between 1 and 20.")
        return value

    @field_validator("max_context_chars")
    @classmethod
    def validate_context_chars(cls, value: int) -> int:
        if value < 500 or value > 50000:
            raise ValueError("MAX_CONTEXT_CHARS must be between 500 and 50000.")
        return value

    @field_validator("rag_max_question_chars")
    @classmethod
    def validate_question_chars(cls, value: int) -> int:
        if value < 20 or value > 4000:
            raise ValueError("RAG_MAX_QUESTION_CHARS must be between 20 and 4000.")
        return value

    @field_validator("rag_min_score")
    @classmethod
    def validate_rag_min_score(cls, value: float) -> float:
        if value < 0 or value > 1:
            raise ValueError("RAG_MIN_SCORE must be between 0 and 1.")
        return value

    @field_validator("rag_rate_limit")
    @classmethod
    def validate_rag_rate_limit(cls, value: int) -> int:
        if value < 1 or value > 200:
            raise ValueError("RAG_RATE_LIMIT must be between 1 and 200.")
        return value

    @field_validator("rag_rate_window_seconds")
    @classmethod
    def validate_rag_window(cls, value: int) -> int:
        if value < 10 or value > 3600:
            raise ValueError("RAG_RATE_WINDOW_SECONDS must be between 10 and 3600.")
        return value

    @field_validator("refresh_token_expire_days")
    @classmethod
    def validate_refresh_ttl(cls, value: int) -> int:
        if value < 1 or value > 90:
            raise ValueError("REFRESH_TOKEN_EXPIRE_DAYS must be between 1 and 90.")
        return value

    def model_post_init(self, __context: object) -> None:
        if self.jwt_secret_key == self.jwt_refresh_secret_key:
            raise ValueError("JWT_REFRESH_SECRET_KEY must differ from JWT_SECRET_KEY.")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def storage_path(self) -> Path:
        return BACKEND_DIR / "storage"


@lru_cache
def get_settings() -> Settings:
    return Settings()
