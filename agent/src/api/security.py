"""Local request guards, CORS parsing, DNS-rebinding guard, and shell-tools gating."""

from __future__ import annotations

import ipaddress
import logging
import re
import urllib.parse
from pathlib import Path
from typing import List, Optional

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse

from src.session.models import AuthMethod, Principal

from src.api._compat import host_attr as _host_attr
from src.config.accessor import get_env_config


# ============================================================================
# Constants
# ============================================================================

_DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
)

# Opt-in additive CORS origins. Unlike ``CORS_ORIGINS`` — which *replaces* the
# loopback defaults — entries here are appended to whatever the effective origin
# list already is, so trusting one extra browser origin never silently drops the
# bundled Web UI. Every entry widens a credentialed CORS surface across the whole
# API (see ``add_middleware(CORSMiddleware, allow_credentials=True)`` in
# ``api_server.py``), so it stays empty by default and off the loopback contract.
# Example — trust OpenBB Workspace as a custom-agent host:
#     VIBE_TRADING_EXTRA_CORS_ORIGINS=https://pro.openbb.co
# Set it as a real process env var (shell export / docker-compose `environment:` /
# systemd). Like ``CORS_ORIGINS``, it is resolved when ``api_server`` builds the
# middleware, which happens before ``run_preflight()`` loads ``agent/.env`` —
# a value living only in that file would be read too late.
_EXTRA_CORS_ORIGINS_ENV = "VIBE_TRADING_EXTRA_CORS_ORIGINS"

_DEFAULT_LOOPBACK_HOSTS = frozenset({
    "localhost",
    "127.0.0.1",
    "::1",
    "[::1]",
    "testserver",
})

_SAFE_BROWSER_METHODS = {"GET", "HEAD", "OPTIONS"}


# ============================================================================
# CORS / host parsing
# ============================================================================


def _parse_cors_origins(raw: Optional[str]) -> List[str]:
    """Parse CORS origins and reject credentialed wildcard configuration."""
    if raw is None or not raw.strip():
        return list(_DEFAULT_CORS_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    if "*" in origins:
        raise RuntimeError(
            "CORS_ORIGINS='*' is not allowed while credentials are enabled; "
            "configure explicit Web UI origins instead."
        )
    return origins


def _parse_extra_cors_origins(raw: Optional[str]) -> List[str]:
    """Parse the additive CORS origin allow-list, rejecting a wildcard.

    Args:
        raw: Comma-separated origin list from ``VIBE_TRADING_EXTRA_CORS_ORIGINS``,
            or ``None`` / empty when the operator opted out.

    Returns:
        The explicit extra origins, in declaration order.

    Raises:
        RuntimeError: If ``*`` is requested; credentialed CORS forbids it.
    """
    if raw is None or not raw.strip():
        return []
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    if "*" in origins:
        raise RuntimeError(
            f"{_EXTRA_CORS_ORIGINS_ENV}='*' is not allowed while credentials are "
            "enabled; list explicit origins instead."
        )
    return origins


def _parse_extra_loopback_hosts(raw: Optional[str]) -> set[str]:
    """Return additional trusted Host names for loopback API traffic."""
    if raw is None or not raw.strip():
        return set()
    return {host.strip().lower().rstrip(".") for host in raw.split(",") if host.strip()}


def _get_extra_loopback_hosts() -> set[str]:
    from src.config.accessor import get_env_config
    return _parse_extra_loopback_hosts(get_env_config().api.api_allowed_hosts or None)


def _host_without_port(host: str) -> str:
    """Normalize a Host header to a lowercase hostname without a port."""
    value = host.strip().lower().rstrip(".")
    if not value:
        return ""
    if value.startswith("["):
        end = value.find("]")
        if end != -1:
            return value[: end + 1]
        return value
    if value.count(":") == 1:
        return value.rsplit(":", 1)[0]
    return value


def _is_allowed_loopback_host(host: str) -> bool:
    """Return whether *host* is allowed for loopback-trusted API requests."""
    normalized = _host_without_port(host)
    return normalized in _DEFAULT_LOOPBACK_HOSTS or normalized in _get_extra_loopback_hosts()


def _is_loopback_bind_host(host: str) -> bool:
    """Return whether *host* resolves to a loopback interface."""
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


def _get_cors_origins() -> List[str]:
    """Return the effective CORS allow-list: base origins plus opt-in extras."""
    from src.config.accessor import get_env_config

    config = get_env_config().api
    origins = _parse_cors_origins(config.cors_origins or None)
    for origin in _parse_extra_cors_origins(
        config.vibe_trading_extra_cors_origins or None
    ):
        if origin not in origins:
            origins.append(origin)
    return origins


# ============================================================================
# DNS-rebinding middleware
# ============================================================================


async def _reject_untrusted_loopback_host(request: Request, call_next):
    """Block DNS-rebinding Host headers before loopback auth bypasses run."""
    if _is_local_client(request) and not _is_allowed_loopback_host(request.headers.get("host", "")):
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Untrusted local API host"},
        )
    return await call_next(request)


# ============================================================================
# Security-headers middleware
# ============================================================================

# Deny powerful browser features the app never uses.
_PERMISSIONS_POLICY = (
    "geolocation=(), camera=(), microphone=(), payment=(), usb=(), "
    "magnetometer=(), gyroscope=(), accelerometer=()"
)

# Enforced by default. Scoped to what the built SPA needs: same-origin
# scripts/styles/fonts/img plus same-origin fetch & EventSource. Inline styles
# are allowed because ECharts and React ``style={}`` props set them; fonts are
# self-hosted (@fontsource) so no external font host is listed. The SPA entry is
# an external module script and ``lib/api.ts`` fetches a same-origin base, so
# no inline-script or cross-origin-connect allowance is needed.
#
# Set ``VIBE_TRADING_CSP_REPORT_ONLY=1`` to ship this Report-Only instead --
# a rollback switch for deployments serving assets this policy does not cover.
_CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

# Swagger UI and ReDoc load their bundle and stylesheet from jsdelivr and run a
# bootstrap block that FastAPI's ``get_swagger_ui_html`` / ``get_redoc_html``
# hardcode inline, so the strict policy above would leave both pages blank.
# Both routes require auth and render only the OpenAPI schema, so they get a
# narrowly scoped exception rather than relaxing the policy app-wide. Favicons
# are pointed at the self-hosted ``/favicon.svg`` so ``img-src`` stays tight.
_CSP_DOCS_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "img-src 'self' data:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

_CSP_DOCS_PATHS = frozenset({"/docs", "/redoc"})


def _csp_header_name() -> str:
    """Return the CSP header to emit (enforcing unless opted out)."""
    if get_env_config().api.vibe_trading_csp_report_only:
        return "Content-Security-Policy-Report-Only"
    return "Content-Security-Policy"


async def _apply_security_headers(request: Request, call_next):
    """Attach baseline security response headers to every response.

    HSTS is deliberately NOT set here: the app is commonly deployed behind a
    TLS-terminating reverse proxy and cannot guarantee it is always served over
    HTTPS. Set ``Strict-Transport-Security`` at the proxy/ingress layer that
    terminates TLS instead.
    """
    response = await call_next(request)
    headers = response.headers
    policy = (
        _CSP_DOCS_POLICY if request.url.path in _CSP_DOCS_PATHS else _CSP_POLICY
    )
    headers.setdefault(_csp_header_name(), policy)
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    headers.setdefault("Permissions-Policy", _PERMISSIONS_POLICY)
    headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


# ============================================================================
# Access-log secret redaction
# ============================================================================

# Redact the VALUES of sensitive query params (keeping the name) from access
# logs. Uvicorn's default access logger writes the full request line including
# the query string, so without this an ``api_key=`` / ``ticket=`` value would
# land in logs verbatim.
_QUERY_SECRET_RE = re.compile(r"((?:api_key|ticket)=)[^&\s\"']+", re.IGNORECASE)


def _redact_query_secrets(text: str) -> str:
    """Replace ``api_key=``/``ticket=`` values with a fixed placeholder."""
    return _QUERY_SECRET_RE.sub(r"\1***REDACTED***", text)


class _AccessLogRedactionFilter(logging.Filter):
    """Strip secret query-param values from log records before they are emitted."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                _redact_query_secrets(a) if isinstance(a, str) else a
                for a in record.args
            )
        if isinstance(record.msg, str):
            record.msg = _redact_query_secrets(record.msg)
        return True


def install_access_log_redaction_filter() -> None:
    """Attach the redaction filter to Uvicorn's access/error loggers.

    Idempotent: skips a logger that already carries the filter so repeated
    server starts in one process don't stack duplicate filters.
    """
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        target = logging.getLogger(name)
        if any(isinstance(f, _AccessLogRedactionFilter) for f in target.filters):
            continue
        target.addFilter(_AccessLogRedactionFilter())


def _is_loopback_origin(origin: str) -> bool:
    """Return whether a browser Origin header names a loopback web UI."""
    try:
        parsed = urllib.parse.urlsplit(origin)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _origin_matches_request_host(origin: str, request: Request) -> bool:
    """Return whether *origin* is the same site serving this request."""
    try:
        parsed = urllib.parse.urlsplit(origin)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False

    origin_host = parsed.hostname.rstrip(".").lower()
    origin_port = parsed.port
    request_host = _host_without_port(request.headers.get("host", ""))
    if origin_host != request_host:
        return False

    if origin_port is None:
        origin_port = 443 if parsed.scheme == "https" else 80
    request_port = request.url.port
    if request_port is None:
        request_port = 443 if request.url.scheme == "https" else 80
    return origin_port == request_port


def _reject_cross_site_browser_request(request: Request) -> None:
    """Reject unsafe browser requests from untrusted cross-site origins."""
    sec_fetch_site = request.headers.get("sec-fetch-site", "").lower()
    if sec_fetch_site == "cross-site":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-site request denied")

    origin = request.headers.get("origin")
    if origin and not (_is_loopback_origin(origin) or _origin_matches_request_host(origin, request)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-site request denied")


#: Subject recorded for requests from this computer (loopback peer).
LOOPBACK_SUBJECT = "loopback-operator"


def _require_local_request(request: Request) -> Principal:
    """Local request guard (not authentication; see ADR 0002).

    Rejects cross-site browser writes and any peer that is not this computer,
    then returns the loopback :class:`~src.session.models.Principal`.
    """
    if request.method.upper() not in _SAFE_BROWSER_METHODS:
        _reject_cross_site_browser_request(request)
    if _is_local_client(request):
        return Principal(subject=LOOPBACK_SUBJECT, auth_method=AuthMethod.LOOPBACK_TRUST)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Vibe Crypto only accepts requests from this computer",
    )


def _require_shutdown_authorization(*, request: Request) -> None:
    """Local request guard for the shutdown control-plane action."""
    _require_local_request(request)


def _is_local_client(request: Request) -> bool:
    """Return whether the request originates from a loopback client."""
    host = request.client.host if request.client else ""
    if host in {"localhost", "testclient"}:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    return _trusted_docker_loopback_ip(ip)


# ============================================================================
# Docker / shell helpers
# ============================================================================


def _default_gateway_ips() -> set[ipaddress.IPv4Address]:
    """Return IPv4 default gateway addresses from Linux procfs."""
    gateways: set[ipaddress.IPv4Address] = set()
    try:
        lines = Path("/proc/net/route").read_text(encoding="utf-8").splitlines()
    except OSError:
        return gateways

    for line in lines[1:]:
        fields = line.split()
        if len(fields) < 3 or fields[1] != "00000000":
            continue
        try:
            raw = int(fields[2], 16).to_bytes(4, byteorder="little")
            gateways.add(ipaddress.IPv4Address(raw))
        except ValueError:
            continue
    return gateways


def _trusted_docker_loopback_ip(ip: ipaddress._BaseAddress) -> bool:
    """Return whether an IP is the explicitly trusted Docker host gateway."""
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    if not get_env_config().api.vibe_trading_trust_docker_loopback:
        return False
    gateway_fn = _host_attr("_default_gateway_ips", _default_gateway_ips)
    return ip in gateway_fn()


def _env_shell_tools_enabled() -> bool:
    """Return whether server-side shell tools are explicitly enabled."""
    return get_env_config().api.vibe_trading_enable_shell_tools


def _shell_tools_enabled_for_request(request: Request) -> bool:
    """Return whether this API request may expose shell tools to the agent."""
    return _env_shell_tools_enabled()


# ============================================================================
# Local request guards (FastAPI Depends)
# ============================================================================
# Vibe Crypto has no login (ADR 0002). These dependencies keep their historical
# names so route modules do not change; they only reject cross-site browser
# writes and peers that are not this computer.


async def require_auth(request: Request) -> Principal:
    """Local request guard, not authentication (ADR 0002).

    Returns the loopback :class:`~src.session.models.Principal`. Routes that
    only need the check use ``dependencies=[Depends(require_auth)]``.

    Raises:
        HTTPException: 403 for cross-site browser writes or non-local peers.
    """
    return _require_local_request(request)


async def require_event_stream_auth(request: Request) -> None:
    """Local request guard for browser EventSource streams (ADR 0002)."""
    _require_local_request(request)


async def require_local_or_auth(request: Request) -> None:
    """Local request guard for settings reads (ADR 0002)."""
    _require_local_request(request)


async def require_settings_write_auth(request: Request) -> None:
    """Local request guard for settings writes (ADR 0002)."""
    _require_local_request(request)


_LEGACY_LAZY_NAMES = {
    "_CORS_ORIGINS": _get_cors_origins,
    "_EXTRA_LOOPBACK_HOSTS": _get_extra_loopback_hosts,
}


def __getattr__(name: str):
    if name in _LEGACY_LAZY_NAMES:
        return _LEGACY_LAZY_NAMES[name]()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
