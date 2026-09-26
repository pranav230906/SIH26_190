"""Secure DMS API entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import access_requests, audit, auth, cases, departments, documents, evidence, forensics, rag, revisions, search, users
from app.core.request_context import reset_request_context, set_request_context
from app.core.config import get_settings
from app.core.database import engine
from app.core.exceptions import AppError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("secure_dms")

_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    logger.info("Database connection verified")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Secure DMS",
        summary="Case-centric document management prototype.",
        description=(
            "Authentication and case foundation for a demonstration system. "
            "Use fictional data only. Authorization decisions are made on the server."
        ),
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        debug=False,
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def capture_request_context(request: Request, call_next):
        host = request.client.host if request.client is not None else None
        tokens = set_request_context(host, request.headers.get("user-agent"))
        try:
            return await call_next(request)
        finally:
            reset_request_context(tokens)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    app.include_router(auth.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(departments.router, prefix="/api")
    app.include_router(cases.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(revisions.router, prefix="/api")
    app.include_router(evidence.router, prefix="/api")
    app.include_router(forensics.router, prefix="/api")
    app.include_router(search.router, prefix="/api")
    app.include_router(rag.router, prefix="/api")
    app.include_router(access_requests.router, prefix="/api")
    app.include_router(audit.router, prefix="/api")

    @app.get("/api/health", tags=["Health"])
    def health() -> dict[str, str]:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ok"}

    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        body: dict = {"code": exc.code, "message": exc.message}
        if exc.details:
            body["details"] = exc.details
        return JSONResponse(status_code=exc.status_code, content={"error": body})

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        code = _STATUS_CODES.get(exc.status_code, "error")
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": code, "message": message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for error in exc.errors():
            location = [
                str(part)
                for part in error.get("loc", [])
                if part not in {"body", "query", "path"}
            ]
            details.append(
                {
                    "field": ".".join(location) or "request",
                    "message": str(error.get("msg", "Invalid value")),
                }
            )
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Request validation failed.",
                    "details": details,
                }
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled application error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred.",
                }
            },
        )

    return app


app = create_app()
