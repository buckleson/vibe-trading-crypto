"""T02 acceptance tests: app authentication removed, local request guards kept.

ADR 0002: Vibe Crypto is a local single-user app. There is no API key, Bearer
token, SSE ticket or ``/auth`` route. What remains is a local request guard:
cross-site Origin rejection for unsafe methods, loopback-only peers, the Host
allow-list middleware (DNS rebinding) and security headers.

Offline and deterministic: requests go through FastAPI's in-process
TestClient or are built directly from ASGI scopes. No network is used.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import inspect
import os
import re
import stat
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

import api_server
import src.api.security as security
from src.session.models import AuthMethod, Principal

REPO = Path(__file__).resolve().parents[3]
AGENT = REPO / "agent"
LOCAL_DETAIL = "Vibe Crypto only accepts requests from this computer"
CROSS_SITE_DETAIL = "Cross-site request denied"
REBIND_DETAIL = "Untrusted local API host"

PUBLIC_GUARDS = (
    "require_auth",
    "require_event_stream_auth",
    "require_local_or_auth",
    "require_settings_write_auth",
)


# --------------------------------------------------------------------------- helpers


def make_request(
    method: str = "GET",
    *,
    client: tuple[str, int] | None = ("127.0.0.1", 50000),
    headers: dict[str, str] | None = None,
    host: str = "127.0.0.1:8899",
    path: str = "/skills",
) -> Request:
    """Build a bare Starlette request from an ASGI scope (no app involved)."""
    raw = {"host": host}
    raw.update({k.lower(): v for k, v in (headers or {}).items()})
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(k.encode("latin-1"), v.encode("latin-1")) for k, v in raw.items()],
        "client": client,
        "server": ("127.0.0.1", 8899),
    }
    return Request(scope)


def run(coro):
    return asyncio.run(coro)


def local_client() -> TestClient:
    return TestClient(api_server.app, client=("127.0.0.1", 50000))


def remote_client(ip: str = "203.0.113.7") -> TestClient:
    return TestClient(api_server.app, client=(ip, 50000))


@pytest.fixture(autouse=True)
def _no_docker_trust(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VIBE_TRADING_TRUST_DOCKER_LOOPBACK", raising=False)
    monkeypatch.delenv("API_ALLOWED_HOSTS", raising=False)


# --------------------------------------------------------------------------- 1a. removed names


REMOVED_SECURITY_NAMES = [
    "_sweep_expired_sse_tickets_locked",
    "_mint_sse_ticket",
    "_consume_sse_ticket",
    "_get_api_key",
    "_configured_api_key",
    "_auth_credential_from_header_or_query",
    "_validate_api_auth",
    "SHARED_KEY_SUBJECT",
    "_security",
    "_API_KEY",
    "HTTPBearer",
    "HTTPAuthorizationCredentials",
]


@pytest.mark.parametrize("name", REMOVED_SECURITY_NAMES)
def test_removed_name_is_gone_from_security_module(name: str) -> None:
    assert not hasattr(security, name)


@pytest.mark.parametrize("name", REMOVED_SECURITY_NAMES)
def test_removed_name_is_not_reexported_by_api_server(name: str) -> None:
    assert not hasattr(api_server, name)


def test_module_has_no_sse_ticket_state() -> None:
    ticket_like = [n for n in vars(security) if "ticket" in n.lower()]
    assert ticket_like == []


def test_legacy_lazy_names_drop_api_key_but_keep_cors() -> None:
    assert "_API_KEY" not in security._LEGACY_LAZY_NAMES
    assert set(security._LEGACY_LAZY_NAMES) == {"_CORS_ORIGINS", "_EXTRA_LOOPBACK_HOSTS"}
    with pytest.raises(AttributeError):
        security.__getattr__("_API_KEY")
    assert isinstance(security._CORS_ORIGINS, list)


def test_security_source_has_no_bearer_or_hmac_imports() -> None:
    src = (AGENT / "src" / "api" / "security.py").read_text(encoding="utf-8")
    for needle in ("HTTPBearer", "HTTPAuthorizationCredentials", "import hmac", "import secrets",
                   "API_AUTH_KEY", "api_auth_key", "compare_digest"):
        assert needle not in src, needle


def test_loopback_subject_kept() -> None:
    assert security.LOOPBACK_SUBJECT == "loopback-operator"


# --------------------------------------------------------------------------- 2. auth_routes deleted


def test_auth_routes_module_is_deleted() -> None:
    assert not (AGENT / "src" / "api" / "auth_routes.py").exists()
    assert importlib.util.find_spec("src.api.auth_routes") is None


def test_api_server_does_not_register_auth_routes() -> None:
    assert not hasattr(api_server, "register_auth_routes")
    src = (AGENT / "api_server.py").read_text(encoding="utf-8")
    assert "auth_routes" not in src
    assert "register_auth_routes" not in src


def test_no_route_lives_under_auth_prefix() -> None:
    paths = [getattr(r, "path", "") for r in api_server.app.routes]
    assert not [p for p in paths if p == "/auth" or p.startswith("/auth/")]


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "DELETE"])
def test_sse_ticket_endpoint_is_gone(method: str) -> None:
    response = local_client().request(method, "/auth/sse-ticket")
    assert response.status_code in {404, 405}


def test_openapi_schema_declares_no_security_scheme() -> None:
    schema = local_client().get("/openapi.json")
    assert schema.status_code == 200
    body = schema.json()
    assert "securitySchemes" not in body.get("components", {})
    assert not [p for p in body.get("paths", {}) if p.startswith("/auth")]
    for path_item in body.get("paths", {}).values():
        for op in path_item.values():
            if isinstance(op, dict):
                assert "security" not in op


# --------------------------------------------------------------------------- 1b. _require_local_request


@pytest.mark.parametrize(
    "client",
    [("127.0.0.1", 1), ("127.8.9.10", 1), ("::1", 1), ("localhost", 1), ("testclient", 1)],
)
def test_local_request_returns_loopback_principal(client: tuple[str, int]) -> None:
    principal = security._require_local_request(make_request(client=client))
    assert isinstance(principal, Principal)
    assert principal.subject == security.LOOPBACK_SUBJECT
    assert principal.auth_method == AuthMethod.LOOPBACK_TRUST


@pytest.mark.parametrize(
    "client",
    [
        ("203.0.113.7", 1),
        ("10.0.0.5", 1),
        ("192.168.1.20", 1),
        ("172.17.0.1", 1),
        ("0.0.0.0", 1),
        ("2001:db8::1", 1),
        ("not-an-ip", 1),
        ("", 1),
        None,
    ],
)
def test_non_local_peer_gets_403(client) -> None:
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(make_request(client=client))
    assert exc.value.status_code == 403
    assert exc.value.detail == LOCAL_DETAIL


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS", "get", "head"])
def test_safe_methods_skip_origin_check(method: str) -> None:
    request = make_request(method, headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"})
    assert security._require_local_request(request).subject == security.LOOPBACK_SUBJECT


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "post", "Delete"])
@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "http://localhost.evil.example",
        "http://127.0.0.1.evil.example",
        "null",
        "file://",
        "chrome-extension://abcdef",
        "http://192.168.1.20:5173",
    ],
)
def test_unsafe_method_with_foreign_origin_is_rejected(method: str, origin: str) -> None:
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(make_request(method, headers={"Origin": origin}))
    assert exc.value.status_code == 403
    assert exc.value.detail == CROSS_SITE_DETAIL


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_sec_fetch_site_cross_site_rejects_writes_even_without_origin(method: str) -> None:
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(make_request(method, headers={"Sec-Fetch-Site": "Cross-Site"}))
    assert exc.value.detail == CROSS_SITE_DETAIL


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "http://127.0.0.1:5173"},
        {"Origin": "http://localhost:3000"},
        {"Origin": "https://localhost"},
        {"Origin": "http://[::1]:5173"},
        {"Origin": "http://127.0.0.2:9999"},
        {"Origin": "http://127.0.0.1:8899"},  # same site as the request host
        {"Sec-Fetch-Site": "same-origin"},
        {"Sec-Fetch-Site": "same-site"},
        {"Sec-Fetch-Site": "none"},
    ],
)
def test_writes_from_local_origins_pass(headers: dict[str, str]) -> None:
    principal = security._require_local_request(make_request("POST", headers=headers))
    assert principal.auth_method == AuthMethod.LOOPBACK_TRUST


def test_origin_matching_a_custom_request_host_passes() -> None:
    request = make_request("POST", host="vibe.local:8899", headers={"Origin": "http://vibe.local:8899"})
    assert security._require_local_request(request).subject == security.LOOPBACK_SUBJECT


def test_origin_with_same_host_but_other_port_is_rejected() -> None:
    request = make_request("POST", host="vibe.local:8899", headers={"Origin": "http://vibe.local:9000"})
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(request)
    assert exc.value.detail == CROSS_SITE_DETAIL


def test_cross_site_check_runs_before_peer_check() -> None:
    request = make_request("POST", client=("203.0.113.7", 1), headers={"Origin": "https://evil.example"})
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(request)
    assert exc.value.detail == CROSS_SITE_DETAIL


def test_remote_write_without_origin_gets_local_detail() -> None:
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(make_request("POST", client=("203.0.113.7", 1)))
    assert exc.value.detail == LOCAL_DETAIL


@pytest.mark.parametrize(
    "headers",
    [
        {"Authorization": "Bearer anything"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"X-API-Key": "anything"},
    ],
)
def test_credentials_never_admit_a_remote_peer(headers: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "anything")
    monkeypatch.setenv("VIBE_TRADING_API_KEY", "anything")
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(make_request(client=("203.0.113.7", 1), headers=headers))
    assert exc.value.detail == LOCAL_DETAIL


@pytest.mark.parametrize("header", ["Bearer wrong", "garbage", ""])
def test_bad_credentials_never_reject_a_local_peer(header: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "the-real-key")
    request = make_request("POST", headers={"Authorization": header})
    assert security._require_local_request(request).subject == security.LOOPBACK_SUBJECT


# --------------------------------------------------------------------------- docker gateway trust


def test_docker_gateway_is_local_only_when_trusted(monkeypatch: pytest.MonkeyPatch) -> None:
    import ipaddress

    monkeypatch.setattr(api_server, "_default_gateway_ips", lambda: {ipaddress.IPv4Address("172.17.0.1")})
    request = make_request(client=("172.17.0.1", 1))
    with pytest.raises(HTTPException):
        security._require_local_request(request)

    monkeypatch.setenv("VIBE_TRADING_TRUST_DOCKER_LOOPBACK", "1")
    from src.config.accessor import reset_env_config

    reset_env_config()
    assert security._require_local_request(request).subject == security.LOOPBACK_SUBJECT
    with pytest.raises(HTTPException) as exc:
        security._require_local_request(make_request(client=("172.17.0.2", 1)))
    assert exc.value.detail == LOCAL_DETAIL


# --------------------------------------------------------------------------- 1c. public dependencies


@pytest.mark.parametrize("name", PUBLIC_GUARDS)
def test_public_guard_signature_is_request_only(name: str) -> None:
    fn = getattr(security, name)
    assert inspect.iscoroutinefunction(fn)
    params = list(inspect.signature(fn).parameters.values())
    assert [p.name for p in params] == ["request"]
    assert params[0].default is inspect.Parameter.empty


@pytest.mark.parametrize("name", PUBLIC_GUARDS)
def test_public_guard_docstring_says_local_guard(name: str) -> None:
    doc = getattr(security, name).__doc__ or ""
    assert "Local request guard" in doc
    assert "ADR 0002" in doc


@pytest.mark.parametrize("name", PUBLIC_GUARDS)
def test_public_guards_are_the_ones_api_server_exports(name: str) -> None:
    assert getattr(api_server, name) is getattr(security, name)


def test_require_auth_returns_principal_for_local() -> None:
    principal = run(security.require_auth(make_request()))
    assert principal == Principal(subject=security.LOOPBACK_SUBJECT, auth_method=AuthMethod.LOOPBACK_TRUST)


@pytest.mark.parametrize("name", PUBLIC_GUARDS[1:])
def test_other_guards_return_none_for_local(name: str) -> None:
    assert run(getattr(security, name)(make_request("POST"))) is None


@pytest.mark.parametrize("name", PUBLIC_GUARDS)
def test_every_guard_rejects_remote(name: str) -> None:
    with pytest.raises(HTTPException) as exc:
        run(getattr(security, name)(make_request(client=("198.51.100.4", 1))))
    assert exc.value.status_code == 403
    assert exc.value.detail == LOCAL_DETAIL


@pytest.mark.parametrize("name", PUBLIC_GUARDS)
def test_every_guard_rejects_cross_site_writes(name: str) -> None:
    with pytest.raises(HTTPException) as exc:
        run(getattr(security, name)(make_request("PUT", headers={"Origin": "https://evil.example"})))
    assert exc.value.detail == CROSS_SITE_DETAIL


def test_shutdown_guard_is_keyword_only_local_guard() -> None:
    sig = inspect.signature(security._require_shutdown_authorization)
    assert list(sig.parameters) == ["request"]
    assert sig.parameters["request"].kind is inspect.Parameter.KEYWORD_ONLY
    assert security._require_shutdown_authorization(request=make_request("POST")) is None
    with pytest.raises(HTTPException) as exc:
        security._require_shutdown_authorization(request=make_request("POST", client=("203.0.113.7", 1)))
    assert exc.value.detail == LOCAL_DETAIL
    with pytest.raises(HTTPException) as exc:
        security._require_shutdown_authorization(
            request=make_request("POST", headers={"Origin": "https://evil.example"})
        )
    assert exc.value.detail == CROSS_SITE_DETAIL


# --------------------------------------------------------------------------- end-to-end through the app

# (method, path, json) per guard flavour. Each route is reachable from a
# loopback client with no headers; local status is anything but 401/403.
ROUTES = [
    pytest.param("GET", "/skills", None, id="require_auth-get"),
    pytest.param("GET", "/settings/data-sources", None, id="require_local_or_auth-get"),
    pytest.param("POST", "/api/paper-accounts", {}, id="require_settings_write_auth-post"),
    pytest.param("GET", "/alpha/bench/does-not-exist/stream", None, id="require_event_stream_auth-sse"),
    pytest.param("GET", "/sessions/does-not-exist/events", None, id="require_event_stream_auth-session"),
]


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_local_client_needs_no_headers(method: str, path: str, body) -> None:
    response = local_client().request(method, path, json=body)
    assert response.status_code not in {401, 403}, response.text


@pytest.mark.parametrize("method,path,body", ROUTES)
@pytest.mark.parametrize("ip", ["203.0.113.7", "10.1.2.3", "2001:db8::9"])
def test_remote_client_is_403_with_clear_detail(method: str, path: str, body, ip: str) -> None:
    response = remote_client(ip).request(method, path, json=body)
    assert response.status_code == 403
    assert response.json()["detail"] == LOCAL_DETAIL


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_remote_client_with_bearer_and_query_key_is_still_403(
    method: str, path: str, body, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "secret")
    sep = "&" if "?" in path else "?"
    response = remote_client().request(
        method, f"{path}{sep}api_key=secret&ticket=abc", json=body,
        headers={"Authorization": "Bearer secret"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == LOCAL_DETAIL


def test_response_never_asks_for_bearer_auth() -> None:
    response = remote_client().get("/skills")
    assert "www-authenticate" not in {k.lower() for k in response.headers}


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_cross_site_write_is_rejected_end_to_end(method: str) -> None:
    response = local_client().request(method, "/api/paper-accounts", headers={"Origin": "https://evil.example"})
    # PUT/PATCH/DELETE may not exist on this path (405) but must never succeed.
    assert response.status_code in {403, 405}
    if method == "POST":
        assert response.json()["detail"] == CROSS_SITE_DETAIL


def test_cross_site_get_is_allowed_end_to_end() -> None:
    response = local_client().get("/skills", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "host",
    ["evil.example", "evil.example:8899", "attacker.localhost.evil", "192.168.1.20:8899", "localhost.evil.example"],
)
def test_rebinding_host_headers_are_rejected(host: str) -> None:
    response = local_client().get("/skills", headers={"Host": host})
    assert response.status_code == 403
    assert response.json()["detail"] == REBIND_DETAIL


@pytest.mark.parametrize("host", ["localhost", "localhost:8899", "127.0.0.1:5173", "[::1]:8899", "LOCALHOST.", "testserver"])
def test_loopback_host_headers_are_accepted(host: str) -> None:
    assert local_client().get("/skills", headers={"Host": host}).status_code == 200


def test_extra_allowed_host_is_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_ALLOWED_HOSTS", "vibe.lan")
    from src.config.accessor import reset_env_config

    reset_env_config()
    assert local_client().get("/skills", headers={"Host": "vibe.lan:8899"}).status_code == 200
    assert local_client().get("/skills", headers={"Host": "other.lan"}).status_code == 403


@pytest.mark.parametrize("value", ["anything", "", "Bearer x"])
def test_api_auth_key_env_has_no_effect(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_AUTH_KEY", value)
    monkeypatch.setenv("VIBE_TRADING_API_KEY", value)
    from src.config.accessor import reset_env_config

    reset_env_config()
    assert local_client().get("/skills").status_code == 200
    assert local_client().post("/api/paper-accounts", json={}).status_code not in {401, 403}


@pytest.mark.parametrize("path", ["/skills", "/auth/sse-ticket", "/docs"])
def test_security_headers_on_all_responses(path: str) -> None:
    for client in (local_client(), remote_client()):
        response = client.get(path)
        assert response.headers.get("x-content-type-options") == "nosniff"
        assert response.headers.get("x-frame-options") == "DENY"
        assert "content-security-policy" in {k.lower() for k in response.headers}


def test_security_headers_on_rebinding_rejection() -> None:
    response = local_client().get("/skills", headers={"Host": "evil.example"})
    assert response.status_code == 403
    assert response.headers.get("x-frame-options") == "DENY"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_docs_are_local_only(path: str) -> None:
    assert local_client().get(path).status_code == 200
    remote = remote_client().get(path)
    assert remote.status_code == 403
    assert remote.json()["detail"] == LOCAL_DETAIL


def test_shutdown_endpoint_rejects_remote_and_cross_site() -> None:
    shutdown = [r for r in api_server.app.routes if "shutdown" in getattr(r, "path", "")]
    if not shutdown:
        pytest.skip("no shutdown route in this build")
    path = shutdown[0].path
    with mock.patch("os.kill"), mock.patch("os._exit"):
        assert remote_client().post(path).status_code == 403
        r = local_client().post(path, headers={"Origin": "https://evil.example"})
        assert r.status_code == 403
        assert r.json()["detail"] == CROSS_SITE_DETAIL


def test_access_log_redaction_kept() -> None:
    line = "GET /x?api_key=abc123&ticket=t0k&keep=1 HTTP/1.1"
    out = security._redact_query_secrets(line)
    assert "abc123" not in out and "t0k" not in out
    assert "api_key=***REDACTED***" in out and "ticket=***REDACTED***" in out
    assert "keep=1" in out


# --------------------------------------------------------------------------- 3. server_cli bind warning


def _serve(argv: list[str]) -> None:
    def fake_run(*args, **kwargs):
        raise SystemExit(0)

    with mock.patch("uvicorn.run", fake_run):
        try:
            api_server.serve_main(argv)
        except SystemExit:
            pass


EXPECTED_WARN = (
    "[warn] Binding to {host}: Vibe Crypto rejects requests that do not come from this computer. "
    "Use --host 127.0.0.1."
)


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.5", "example.lan"])
def test_non_loopback_bind_prints_exact_warning(host: str, capsys: pytest.CaptureFixture[str]) -> None:
    _serve(["--host", host])
    assert EXPECTED_WARN.format(host=host) in capsys.readouterr().out


@pytest.mark.parametrize("argv", [[], ["--host", "127.0.0.1"], ["--host", "::1"], ["--host", "localhost"]])
def test_loopback_bind_prints_no_warning(argv: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    _serve(argv)
    assert "rejects requests that do not come from this computer" not in capsys.readouterr().out


def test_bind_warning_does_not_mention_api_key(capsys: pytest.CaptureFixture[str], monkeypatch) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "x")
    _serve(["--host", "0.0.0.0"])
    out = capsys.readouterr().out
    assert "API_AUTH_KEY" not in out
    assert "api key" not in out.lower()


def test_server_cli_has_no_key_helper() -> None:
    import src.api.server_cli as server_cli

    assert not hasattr(server_cli, "_configured_api_key")


# --------------------------------------------------------------------------- 4. config


def test_env_schema_has_no_api_auth_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "x")
    monkeypatch.setenv("VIBE_TRADING_API_KEY", "y")
    from src.config.accessor import get_env_config, reset_env_config

    reset_env_config()
    cfg = get_env_config()
    for section in (cfg, cfg.api):
        assert not hasattr(section, "api_auth_key")
        assert not hasattr(section, "vibe_trading_api_key")
    dumped = repr(cfg.api.model_dump()) if hasattr(cfg.api, "model_dump") else repr(vars(cfg.api))
    assert "'x'" not in dumped and "'y'" not in dumped


def test_env_schema_and_accessor_source_drop_key() -> None:
    for rel in ("src/config/env_schema.py", "src/config/accessor.py"):
        text = (AGENT / rel).read_text(encoding="utf-8")
        for needle in ("api_auth_key", "API_AUTH_KEY", "vibe_trading_api_key", "VIBE_TRADING_API_KEY"):
            assert needle not in text, f"{needle} in {rel}"


def test_api_config_keeps_local_guard_settings() -> None:
    from src.config.env_schema import APIConfig

    fields = set(APIConfig.model_fields)
    assert {"cors_origins", "api_allowed_hosts", "vibe_trading_trust_docker_loopback"} <= fields


# --------------------------------------------------------------------------- 4b. alpha bench cache key


def test_alpha_bench_hmac_key_ignores_api_auth_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from src.tools import alpha_bench_tool as abt

    monkeypatch.setenv("API_AUTH_KEY", "shared-key")
    key1 = abt._cache_hmac_key(tmp_path)
    assert len(key1) == 32
    assert key1 != b"shared-key"
    key_file = tmp_path / ".hmac_key"
    assert bytes.fromhex(key_file.read_text().strip()) == key1
    if os.name == "posix":
        assert stat.S_IMODE(key_file.stat().st_mode) == 0o600
    monkeypatch.setenv("API_AUTH_KEY", "a-different-key")
    assert abt._cache_hmac_key(tmp_path) == key1
    monkeypatch.delenv("API_AUTH_KEY")
    assert abt._cache_hmac_key(tmp_path) == key1


def test_alpha_bench_hmac_key_is_per_directory(tmp_path: Path) -> None:
    from src.tools import alpha_bench_tool as abt

    assert abt._cache_hmac_key(tmp_path / "a") != abt._cache_hmac_key(tmp_path / "b")


def test_alpha_bench_corrupt_key_file_still_yields_32_bytes(tmp_path: Path) -> None:
    from src.tools import alpha_bench_tool as abt

    (tmp_path / ".hmac_key").write_text("not hex")
    assert len(abt._cache_hmac_key(tmp_path)) == 32


def test_alpha_bench_source_has_no_key_usage() -> None:
    text = (AGENT / "src" / "tools" / "alpha_bench_tool.py").read_text(encoding="utf-8")
    assert "API_AUTH_KEY" not in text and "api_auth_key" not in text


def test_scheduled_decay_scan_doc_has_no_key_mention() -> None:
    doc = AGENT / "src" / "skills" / "strategy-dev-manager" / "references" / "scheduled_decay_scan.md"
    text = doc.read_text(encoding="utf-8")
    assert "API_AUTH_KEY" not in text
    assert "Bearer" not in text


# --------------------------------------------------------------------------- 5. CLI clients


def _py_files(*roots: Path):
    for root in roots:
        if root.is_file():
            yield root
            continue
        for p in root.rglob("*.py"):
            if "__pycache__" not in p.parts:
                yield p


def test_cli_sends_no_authorization_header() -> None:
    offenders = []
    for p in _py_files(AGENT / "cli"):
        text = p.read_text(encoding="utf-8")
        if re.search(r"[\"']Authorization[\"']\s*:", text) or "Bearer " in text or "API_AUTH_KEY" in text:
            offenders.append(str(p.relative_to(REPO)))
    assert offenders == []


def test_no_backend_code_reads_api_auth_key() -> None:
    roots = [AGENT / "src", AGENT / "cli", *AGENT.glob("*.py")]
    offenders = []
    for p in _py_files(*roots):
        text = p.read_text(encoding="utf-8")
        for needle in ("API_AUTH_KEY", "_configured_api_key", "sse-ticket", "api_auth_key", "SHARED_KEY_SUBJECT"):
            if needle in text:
                offenders.append(f"{p.relative_to(REPO)}: {needle}")
    assert offenders == []


# --------------------------------------------------------------------------- 6. env example + docker


def test_env_example_has_no_api_auth_key_and_says_no_login() -> None:
    text = (AGENT / ".env.example").read_text(encoding="utf-8")
    assert "API_AUTH_KEY" not in text
    assert "Vibe Crypto has no login; keep the API bound to 127.0.0.1." in text


def test_docker_compose_binds_loopback_and_trusts_gateway() -> None:
    text = (REPO / "docker-compose.yml").read_text(encoding="utf-8")
    assert "API_AUTH_KEY" not in text
    ports = re.findall(r"^\s*-\s*[\"']?([0-9.:]*8899:8899)[\"']?\s*$", text, re.M)
    assert ports == ["127.0.0.1:8899:8899"]
    assert re.search(r"VIBE_TRADING_TRUST_DOCKER_LOOPBACK[=:]\s*[\"']?1", text)


def test_dockerfile_has_no_api_auth_key_and_binds_all_interfaces_inside() -> None:
    text = (REPO / "Dockerfile").read_text(encoding="utf-8")
    assert "API_AUTH_KEY" not in text
    assert '"--host", "0.0.0.0"' in text


def test_license_and_notice_still_present() -> None:
    assert (REPO / "LICENSE").exists()
    assert (REPO / "NOTICE").exists()
