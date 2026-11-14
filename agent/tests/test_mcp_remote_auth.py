"""Token auth for the network MCP transports (ADR 0008)."""

from __future__ import annotations

import asyncio
import os
import secrets
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import mcp_server
import pytest
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

TOK = secrets.token_urlsafe(32)
SERVER = Path(mcp_server.__file__).resolve()
INIT_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
}
INIT_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def test_validate_token():
    good = secrets.token_urlsafe(32)
    assert mcp_server._validate_token(f"  {good} ") == good
    for bad in ["", "short", "has space 1234567890", "a/b" * 10, "a" * 300]:
        with pytest.raises(ValueError):
            mcp_server._validate_token(bad)


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.2", "::1", "[::1]", "LOCALHOST"])
def test_loopback_true(host):
    assert mcp_server._is_loopback_bind(host) is True


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.5", "example.com"])
def test_loopback_false(host):
    assert mcp_server._is_loopback_bind(host) is False


def test_network_security_settings():
    with pytest.raises(ValueError, match="VIBE_CRYPTO_MCP_TOKEN"):
        mcp_server._network_security_settings("0.0.0.0", None, None)
    assert mcp_server._network_security_settings("127.0.0.1", None, None) == (
        None,
        list(mcp_server._DEFAULT_MCP_ALLOWED_HOSTS),
    )
    assert mcp_server._network_security_settings("0.0.0.0", TOK, None) == (TOK, ["*"])
    assert mcp_server._network_security_settings("0.0.0.0", TOK, "mcp.example.com") == (TOK, ["mcp.example.com"])
    with pytest.raises(ValueError):
        mcp_server._network_security_settings("0.0.0.0", "bad", None)


def _tiny_client() -> TestClient:
    async def show(request):
        return JSONResponse({"root_path": request.scope.get("root_path", "")})

    app = Starlette(
        routes=[Route("/mcp", show), Route("/.well-known/oauth-protected-resource", show)],
        middleware=[Middleware(mcp_server._TokenGuardMiddleware, token=TOK)],
    )
    return TestClient(app)


def test_token_middleware():
    c = _tiny_client()
    r = c.get(f"/{TOK}/mcp")
    assert r.status_code == 200 and r.json()["root_path"] == f"/{TOK}"
    assert c.get("/mcp", headers={"Authorization": f"Bearer {TOK}"}).status_code == 200
    r = c.get("/mcp")
    assert r.status_code == 401 and "Bearer" in r.headers["www-authenticate"]
    assert c.get("/mcp", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.get("/WRONGTOKEN/mcp").status_code == 401
    r = c.get("/.well-known/oauth-protected-resource")
    assert r.status_code == 404
    for resp in (c.get("/mcp"), r, c.get("/WRONGTOKEN/mcp")):
        assert TOK not in resp.text and "WRONGTOKEN" not in resp.text


def test_full_app_auth_and_host_guard():
    with TestClient(mcp_server._build_network_app("streamable-http", ["*"], token=TOK)) as c:
        r = c.post(f"/{TOK}/mcp", json=INIT_BODY, headers=INIT_HEADERS)
        assert r.status_code not in (401, 404)
        r = c.post("/mcp", json=INIT_BODY, headers={**INIT_HEADERS, "Authorization": f"Bearer {TOK}"})
        assert r.status_code not in (401, 404)
        assert c.post("/mcp", json=INIT_BODY, headers=INIT_HEADERS).status_code == 401
    with TestClient(mcp_server._build_network_app("streamable-http", ["mcp.example.com"], token=TOK)) as c:
        r = c.post(f"/{TOK}/mcp", json=INIT_BODY, headers={**INIT_HEADERS, "Host": "evil.com"})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Integration (real subprocess)
# ---------------------------------------------------------------------------


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _env(tmp_path: Path, **extra: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("VIBE_CRYPTO_MCP")}
    env.update(HOME=str(tmp_path), NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
    env.update(extra)
    return env


@contextmanager
def _server(tmp_path: Path, transport: str):
    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--transport", transport, "--port", str(port)],
        env=_env(tmp_path, VIBE_CRYPTO_MCP_TOKEN=TOK),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.time() + 90
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"server exited: {proc.stdout.read()}")
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
                break
            except OSError:
                time.sleep(0.3)
        else:
            raise RuntimeError("server not ready")
        yield port
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


async def _count_tools(client) -> int:
    async with client:
        return len(await client.list_tools())


@pytest.mark.integration
def test_integration_http(tmp_path, monkeypatch):
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport

    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    with _server(tmp_path, "http") as port:
        assert asyncio.run(_count_tools(Client(f"http://127.0.0.1:{port}/{TOK}/mcp"))) >= 87
        t = StreamableHttpTransport(f"http://127.0.0.1:{port}/mcp", headers={"Authorization": f"Bearer {TOK}"})
        assert asyncio.run(_count_tools(Client(t))) >= 87
        with pytest.raises(Exception):
            asyncio.run(_count_tools(Client(f"http://127.0.0.1:{port}/mcp")))


@pytest.mark.integration
def test_integration_sse(tmp_path, monkeypatch):
    from fastmcp import Client
    from fastmcp.client.transports import SSETransport

    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    with _server(tmp_path, "sse") as port:
        assert asyncio.run(_count_tools(Client(SSETransport(f"http://127.0.0.1:{port}/{TOK}/sse")))) >= 87
        with pytest.raises(Exception):
            asyncio.run(_count_tools(Client(SSETransport(f"http://127.0.0.1:{port}/sse"))))


@pytest.mark.integration
def test_refuses_public_bind_without_token(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(SERVER), "--transport", "http", "--host", "0.0.0.0", "--port", str(_free_port())],
        env=_env(tmp_path),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 2
    assert "VIBE_CRYPTO_MCP_TOKEN" in proc.stderr
