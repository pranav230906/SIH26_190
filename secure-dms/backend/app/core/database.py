"""SQLAlchemy engines. Alembic, seed, and the audit writer use the table owner.

Request sessions use APP_DATABASE_URL, a login that does not own the tables.
"""

from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.exceptions import AppError


class Base(DeclarativeBase):
    pass


settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)

_app_engine = None
_app_sessionmaker = None


def _clear_app_user(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("SELECT set_config('app.user_id', '', false)")
    finally:
        cursor.close()


def app_engine():
    global _app_engine, _app_sessionmaker
    url = get_settings().app_database_url.strip()
    if not url:
        return None
    if _app_engine is None:
        _app_engine = create_engine(url, pool_pre_ping=True, future=True)
        event.listen(_app_engine, "checkout", _clear_app_user)
        _app_sessionmaker = sessionmaker(
            bind=_app_engine,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
        )
    return _app_engine


def get_db() -> Generator[Session, None, None]:
    app_engine()
    if _app_sessionmaker is None:
        raise AppError(
            503,
            "service_unavailable",
            "APP_DATABASE_URL is not configured. Case queries must use a login that does not own the tables.",
        )
    session = _app_sessionmaker()
    try:
        yield session
    finally:
        try:
            session.rollback()
            session.execute(text("SELECT set_config('app.user_id', '', false)"))
            session.commit()
        except Exception:
            session.rollback()
        session.close()
