"""Request address and user agent for audit records. No device fingerprint is collected."""

from contextvars import ContextVar

_ip: ContextVar[str | None] = ContextVar("audit_ip", default=None)
_user_agent: ContextVar[str | None] = ContextVar("audit_user_agent", default=None)


def set_request_context(ip_address: str | None, user_agent: str | None) -> tuple[object, object]:
    return _ip.set(ip_address), _user_agent.set((user_agent or "")[:300] or None)


def reset_request_context(tokens: tuple[object, object]) -> None:
    _ip.reset(tokens[0])
    _user_agent.reset(tokens[1])


def client_ip() -> str | None:
    return _ip.get()


def client_user_agent() -> str | None:
    return _user_agent.get()
