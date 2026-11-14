"""T15 acceptance edge cases: remote MCP token auth (http/sse) and opt-in order tools.

Complements agent/tests/test_mcp_remote_auth.py and test_mcp_order_tools_optin.py with
boundary and negative cases. Offline and deterministic: in-process ASGI via Starlette's
TestClient, fake registries, and two short-lived subprocesses that exit before binding
(marked integration). No broker, exchange or external network is contacted.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
AGENT_DIR = REPO / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

import mcp_server  # noqa: E402
from src.config.accessor import reset_env_config  # noqa: E402

TOK = "T15_tok-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
SERVER = Path(mcp_server.__file__).resolve()
ORDER_TOOLS = {"trading_place_order", "trading_cancel_order"}
INIT_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t15", "version": "1"}},
}
INIT_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for key in ("VIBE_CRYPTO_MCP_TOKEN", "VIBE_CRYPTO_MCP_ENABLE_ORDERS"):
        monkeypatch.delenv(key, raising=False)
    reset_env_config()
    yield
    mcp_server._unregister_order_tools()
    reset_env_config()


# ---------------------------------------------------------------------------
# _validate_token boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["a" * 16, "Z" * 256, "abc_DEF-123_xyz-9", "\t" + "b" * 20 + "\n"])
def test_validate_token_accepts_boundaries(value):
    assert mcp_server._validate_token(value) == value.strip()


@pytest.mark.parametrize(
    "value",
    [
        "a" * 15,
        "a" * 257,
        "   ",
        "token.with.dots.1234",
        "tok+en=1234567890ab",
        "toké1234567890abcd",
        "a" * 16 + "\x00",
    ],
)
def test_validate_token_rejects(value):
    with pytest.raises(ValueError) as exc:
        mcp_server._validate_token(value)
    msg = str(exc.value)
    assert "VIBE_CRYPTO_MCP_TOKEN" in msg and "token_urlsafe" in msg
    if value.strip():
        assert value.strip() not in msg, "error message must not echo the rejected secret"


# ---------------------------------------------------------------------------
# _is_loopback_bind / _network_security_settings
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("host", ["127.255.255.254", "  127.0.0.1  ", "Localhost", "0:0:0:0:0:0:0:1"])
def test_loopback_more_true(host):
    assert mcp_server._is_loopback_bind(host) is True


@pytest.mark.parametrize(
    "host", ["", "[::]", "10.0.0.1", "localhost.example.com", "127.0.0.1.nip.io", "::ffff:8.8.8.8", "not a host"]
)
def test_loopback_more_false(host):
    assert mcp_server._is_loopback_bind(host) is False


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.5", "example.com"])
def test_non_loopback_without_token_refuses_even_with_allowed_hosts(host):
    with pytest.raises(ValueError) as exc:
        mcp_server._network_security_settings(host, None, "mcp.example.com")
    msg = str(exc.value)
    assert f"Refusing to listen on {host}" in msg
    assert "VIBE_CRYPTO_MCP_TOKEN" in msg and "--token" in msg
    assert "guides/share-with-friends.md" in msg


@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_blank_token_counts_as_no_token(blank):
    with pytest.raises(ValueError, match="Refusing to listen"):
        mcp_server._network_security_settings("0.0.0.0", blank, None)
    tok, hosts = mcp_server._network_security_settings("127.0.0.1", blank, None)
    assert tok is None and hosts == list(mcp_server._DEFAULT_MCP_ALLOWED_HOSTS)


def test_bad_token_rejected_even_on_loopback():
    with pytest.raises(ValueError, match="16 to 256"):
        mcp_server._network_security_settings("127.0.0.1", "short", None)


def test_token_is_stripped_and_wildcard_on_loopback():
    assert mcp_server._network_security_settings("localhost", f"  {TOK} ", None) == (TOK, ["*"])


def test_blank_allowed_hosts_falls_back():
    assert mcp_server._network_security_settings("0.0.0.0", TOK, "  ") == (TOK, ["*"])
    assert mcp_server._network_security_settings("127.0.0.1", None, " ")[1] == list(
        mcp_server._DEFAULT_MCP_ALLOWED_HOSTS
    )


def test_explicit_hosts_win_over_wildcard_and_loopback_default():
    tok, hosts = mcp_server._network_security_settings("0.0.0.0", TOK, "a.example.com, b.example.com")
    assert tok == TOK and set(hosts) >= {"a.example.com", "b.example.com"} and "*" not in hosts
    _, hosts2 = mcp_server._network_security_settings("127.0.0.1", None, "a.example.com")
    assert "*" not in hosts2 and "a.example.com" in hosts2


# ---------------------------------------------------------------------------
# Middleware stack ordering
# ---------------------------------------------------------------------------


def test_security_middleware_stack():
    plain = mcp_server._security_middleware(["127.0.0.1"])
    assert [m.cls for m in plain] == [mcp_server._HostGuardMiddleware, mcp_server._OriginGuardMiddleware]
    assert [m.cls for m in mcp_server._security_middleware(["127.0.0.1"], None)] == [m.cls for m in plain]
    assert [m.cls for m in mcp_server._security_middleware(["127.0.0.1"], "")] == [m.cls for m in plain]
    guarded = mcp_server._security_middleware(["*"], TOK)
    assert [m.cls for m in guarded][-1] is mcp_server._TokenGuardMiddleware
    assert len(guarded) == 3


# ---------------------------------------------------------------------------
# _TokenGuardMiddleware edge cases (tiny Starlette app)
# ---------------------------------------------------------------------------


def _tiny_client(root_path: str = ""):
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.responses import JSONResponse
    from starlette.routing import Route
    from starlette.testclient import TestClient

    async def show(request):
        return JSONResponse({"root_path": request.scope.get("root_path", ""), "path": request.scope["path"]})

    app = Starlette(
        routes=[
            Route("/mcp", show, methods=["GET", "POST"]),
            Route("/messages/", show),
            Route("/.well-known/oauth-protected-resource", show),
        ],
        middleware=[Middleware(mcp_server._TokenGuardMiddleware, token=TOK)],
    )
    return TestClient(app, root_path=root_path)


def _assert_401(r):
    assert r.status_code == 401
    assert r.headers.get("www-authenticate") == 'Bearer realm="vibe-crypto"'
    assert r.json() == {"error": "unauthorized"}
    assert TOK not in r.text
    assert all(TOK not in v for v in r.headers.values())


def test_path_prefix_keeps_path_and_sets_root_path():
    c = _tiny_client()
    r = c.post(f"/{TOK}/mcp")
    assert r.status_code == 200
    assert r.json() == {"root_path": f"/{TOK}", "path": f"/{TOK}/mcp"}
    r = c.get(f"/{TOK}/messages/")
    assert r.status_code == 200 and r.json()["root_path"] == f"/{TOK}"


def test_query_string_token_does_not_authenticate():
    c = _tiny_client()
    _assert_401(c.get(f"/mcp?token={TOK}"))
    _assert_401(c.get(f"/mcp?access_token={TOK}"))


@pytest.mark.parametrize(
    "path",
    [
        f"/mcp/{TOK}",  # token in a later segment
        f"/{TOK}x/mcp",  # token with suffix
        f"/{TOK[:-1]}/mcp",  # token missing last char
        f"/{TOK.upper()}/mcp",  # case changed
        f"/x/{TOK}/mcp",  # nested
        "//mcp",
        "/",
    ],
)
def test_near_miss_paths_are_401(path):
    _assert_401(_tiny_client().get(path))


@pytest.mark.parametrize(
    "value",
    [
        f"bearer {TOK}",  # scheme case
        f"Bearer  {TOK}",  # double space
        f"Bearer {TOK} ",  # trailing space
        f"Bearer {TOK}x",
        f"Basic {TOK}",
        TOK,
        "Bearer ",
        "",
    ],
)
def test_bad_authorization_headers_are_401(value):
    _assert_401(_tiny_client().get("/mcp", headers={"Authorization": value}))


def test_other_header_carrying_token_is_401():
    _assert_401(_tiny_client().get("/mcp", headers={"X-Api-Key": TOK, "Cookie": f"token={TOK}"}))


@pytest.mark.parametrize(
    "path",
    [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
    ],
)
def test_well_known_without_credentials_is_404(path):
    r = _tiny_client().get(path)
    assert r.status_code == 404 and r.text == "Not found"
    assert "www-authenticate" not in {k.lower() for k in r.headers}


def test_well_known_with_bearer_passes_through():
    r = _tiny_client().get("/.well-known/oauth-protected-resource", headers={"Authorization": f"Bearer {TOK}"})
    assert r.status_code == 200


def test_existing_root_path_is_extended():
    c = _tiny_client(root_path="/base")
    r = c.get(f"/base/{TOK}/mcp")
    # Starlette's TestClient prefixes root_path to the request path; the guard sees the
    # first segment "base", not the token, so this must be rejected (the deployment
    # proxy strips its own prefix before the app).
    assert r.status_code == 401


def test_lifespan_and_unknown_scope_types_pass_through():
    seen = []

    async def inner(scope, receive, send):
        seen.append(scope["type"])

    guard = mcp_server._TokenGuardMiddleware(inner, TOK)
    for typ in ("lifespan", "custom"):
        asyncio.run(guard({"type": typ}, None, None))
    assert seen == ["lifespan", "custom"]


def test_websocket_without_credentials_is_closed_1008():
    sent = []

    async def inner(scope, receive, send):  # pragma: no cover - must not run
        raise AssertionError("inner app reached without credentials")

    async def send(msg):
        sent.append(msg)

    guard = mcp_server._TokenGuardMiddleware(inner, TOK)
    asyncio.run(guard({"type": "websocket", "path": "/mcp", "headers": []}, None, send))
    assert sent == [{"type": "websocket.close", "code": 1008}]


def test_websocket_with_path_token_reaches_app():
    seen = {}

    async def inner(scope, receive, send):
        seen.update(scope)

    guard = mcp_server._TokenGuardMiddleware(inner, TOK)
    asyncio.run(guard({"type": "websocket", "path": f"/{TOK}/ws", "headers": []}, None, None))
    assert seen["root_path"] == f"/{TOK}" and seen["path"] == f"/{TOK}/ws"


# ---------------------------------------------------------------------------
# Full FastMCP app (in-process, no sockets)
# ---------------------------------------------------------------------------


def test_full_app_host_guard_runs_before_token():
    from starlette.testclient import TestClient

    app = mcp_server._build_network_app("streamable-http", ["mcp.example.com"], token=TOK)
    with TestClient(app, base_url="http://mcp.example.com") as c:
        # wrong Host with a valid token: host guard answers first
        r = c.post(f"/{TOK}/mcp", json=INIT_BODY, headers={**INIT_HEADERS, "Host": "evil.com"})
        assert r.status_code == 400
        # right Host, no credentials: token guard
        r = c.post("/mcp", json=INIT_BODY, headers=INIT_HEADERS)
        assert r.status_code == 401
        # right Host, bad Origin: origin guard
        r = c.post(f"/{TOK}/mcp", json=INIT_BODY, headers={**INIT_HEADERS, "Origin": "https://evil.com"})
        assert r.status_code == 403
        # right Host, path token
        r = c.post(f"/{TOK}/mcp", json=INIT_BODY, headers=INIT_HEADERS)
        assert r.status_code == 200, r.text[:300]


def test_full_app_wildcard_host_with_token_accepts_random_tunnel_host():
    from starlette.testclient import TestClient

    _, hosts = mcp_server._network_security_settings("0.0.0.0", TOK, None)
    app = mcp_server._build_network_app("streamable-http", hosts, token=TOK)
    with TestClient(app, base_url="https://random-words-1234.trycloudflare.com") as c:
        r = c.post(f"/{TOK}/mcp", json=INIT_BODY, headers=INIT_HEADERS)
        assert r.status_code == 200, r.text[:300]
        r = c.post("/mcp", json=INIT_BODY, headers=INIT_HEADERS)
        assert r.status_code == 401 and TOK not in r.text


def test_full_app_without_token_unchanged():
    from starlette.testclient import TestClient

    app = mcp_server._build_network_app("streamable-http", list(mcp_server._DEFAULT_MCP_ALLOWED_HOSTS))
    with TestClient(app, base_url="http://127.0.0.1") as c:
        r = c.post("/mcp", json=INIT_BODY, headers=INIT_HEADERS)
        assert r.status_code == 200, r.text[:300]


# ---------------------------------------------------------------------------
# main() wiring (source-level, no server start)
# ---------------------------------------------------------------------------


def _main_src() -> str:
    src = SERVER.read_text(encoding="utf-8")
    return src[src.index("def main():") :]


def test_main_flags_and_order():
    src = _main_src()
    for flag in ("--token", "--allowed-hosts", "--enable-order-tools", "--enable-shell-tools"):
        assert f'"{flag}"' in src
    # order-tool switch resolved before .env is loaded
    assert src.index("_resolve_include_order_tools(") < src.index("_ensure_dotenv()")
    assert src.index("_resolve_include_shell_tools(") < src.index("_ensure_dotenv()")
    # token read after .env so a .env token works
    assert src.index("_ensure_dotenv()") < src.index("vibe_crypto_mcp_token")
    assert "sys.exit(2)" in src
    assert "access_log=not token" in src


def test_help_lists_new_flags():
    proc = subprocess.run(
        [sys.executable, str(SERVER), "--help"], capture_output=True, text=True, timeout=120, cwd=str(REPO)
    )
    assert proc.returncode == 0, proc.stderr[-500:]
    out = re.sub(r"\s+", " ", proc.stdout)
    for needle in (
        "--token",
        "--allowed-hosts",
        "--enable-order-tools",
        "VIBE_CRYPTO_MCP_TOKEN",
        "VIBE_CRYPTO_MCP_ENABLE_ORDERS",
    ):
        assert needle in out


def test_module_docstring_mentions_opt_in():
    doc = mcp_server.__doc__ or ""
    assert "--enable-order-tools" in doc and "ADR 0008" in doc
    assert "VIBE_CRYPTO_MCP_TOKEN" in doc and re.search(r"/<(token|secret)>/mcp", doc)


def _sub_env(tmp_path: Path, **extra: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("VIBE_CRYPTO_MCP")}
    env.update(HOME=str(tmp_path), NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
    env.update(extra)
    return env


@pytest.mark.integration
def test_cli_bad_token_exits_2_without_echoing_it(tmp_path):
    bad = "tooShort9"
    proc = subprocess.run(
        [sys.executable, str(SERVER), "--transport", "http", "--port", "1", "--token", bad],
        env=_sub_env(tmp_path),
        capture_output=True,
        text=True,
        timeout=90,
        cwd=str(tmp_path),
    )
    assert proc.returncode == 2
    assert "VIBE_CRYPTO_MCP_TOKEN must be 16 to 256" in proc.stderr
    assert bad not in proc.stderr + proc.stdout


@pytest.mark.integration
def test_cli_token_from_dotenv_is_used(tmp_path):
    # A .env token is read (after _ensure_dotenv). Prove it with an invalid one so the
    # process exits before binding a socket.
    (tmp_path / ".vibe-trading").mkdir()
    (tmp_path / ".vibe-trading" / ".env").write_text("VIBE_CRYPTO_MCP_TOKEN=bad/token\n")
    proc = subprocess.run(
        [sys.executable, str(SERVER), "--transport", "sse", "--host", "0.0.0.0", "--port", "1"],
        env=_sub_env(tmp_path),
        capture_output=True,
        text=True,
        timeout=90,
        cwd=str(tmp_path),
    )
    assert proc.returncode == 2
    assert "16 to 256" in proc.stderr and "Refusing" not in proc.stderr


# ---------------------------------------------------------------------------
# Order tools: parameter mapping (fake registry, no broker)
# ---------------------------------------------------------------------------


class _FakeRegistry:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute(self, name, params):
        self.calls.append((name, dict(params)))
        return json.dumps({"status": "ok", "tool": name})


@pytest.fixture
def fake_registry(monkeypatch):
    reg = _FakeRegistry()
    monkeypatch.setattr(mcp_server, "_get_registry", lambda: reg)
    return reg


def test_place_order_drops_none_and_maps_fields(fake_registry):
    out = mcp_server.trading_place_order(symbol="BTC/USDT", side="sell", notional=25.0, connection="binance-paper")
    assert json.loads(out)["tool"] == "trading_place_order"
    name, params = fake_registry.calls[-1]
    assert name == "trading_place_order"
    assert params["symbol"] == "BTC/USDT" and params["side"] == "sell" and params["notional"] == 25.0
    assert params["order_type"] == "market" and params["time_in_force"] == "day"
    assert "quantity" not in params and "limit_price" not in params
    assert all(v is not None for v in params.values())
    assert "binance-paper" in json.dumps(params)


def test_place_limit_order_keeps_limit_price(fake_registry):
    mcp_server.trading_place_order(
        symbol="AAPL", side="buy", quantity=2, order_type="limit", limit_price=101.5, time_in_force="gtc", account="A1"
    )
    _, params = fake_registry.calls[-1]
    assert params["order_type"] == "limit" and params["limit_price"] == 101.5 and params["time_in_force"] == "gtc"
    assert params["quantity"] == 2
    assert "A1" in json.dumps(params)


def test_cancel_order_optional_symbol(fake_registry):
    mcp_server.trading_cancel_order(order_id="O-9")
    name, params = fake_registry.calls[-1]
    assert name == "trading_cancel_order" and params["order_id"] == "O-9" and "symbol" not in params
    mcp_server.trading_cancel_order(order_id="O-9", symbol="ETH/USDT", connection_id="c1")
    _, params = fake_registry.calls[-1]
    assert params["symbol"] == "ETH/USDT" and "c1" in json.dumps(params)


def test_place_order_docstring_has_safety_rules():
    doc = re.sub(r"\s+", " ", mcp_server.trading_place_order.__doc__ or "")
    for needle in (
        "sandbox",
        "mandate",
        "kill switch",
        "explicit confirmation",
        "Never retry",
        "exactly one of quantity or notional",
    ):
        assert needle in doc, needle


async def _list(target):
    from fastmcp import Client

    async with Client(target) as c:
        return await c.list_tools()


def test_register_unregister_roundtrip_restores_tool_count():
    before = {t.name for t in asyncio.run(_list(mcp_server.mcp))}
    assert not before & ORDER_TOOLS
    mcp_server._register_order_tools()
    mcp_server._register_order_tools()
    tools = asyncio.run(_list(mcp_server.mcp))
    names = [t.name for t in tools]
    assert sorted(n for n in names if n in ORDER_TOOLS) == sorted(ORDER_TOOLS)
    assert set(names) - before == ORDER_TOOLS
    place = next(t for t in tools if t.name == "trading_place_order")
    ann = place.annotations
    assert ann.idempotentHint is False and ann.openWorldHint is True
    props = place.inputSchema["properties"]
    assert set(props) >= {"symbol", "side", "quantity", "notional", "order_type", "limit_price", "time_in_force"}
    assert set(place.inputSchema.get("required", [])) == {"symbol", "side"}
    side_schema = json.dumps(props["side"])
    assert '"buy"' in side_schema and '"sell"' in side_schema
    mcp_server._unregister_order_tools()
    mcp_server._unregister_order_tools()  # second call is harmless
    assert {t.name for t in asyncio.run(_list(mcp_server.mcp))} == before
    mcp_server._register_order_tools()  # can register again after unregister
    assert ORDER_TOOLS <= {t.name for t in asyncio.run(_list(mcp_server.mcp))}


def test_invalid_side_rejected_by_schema(fake_registry):
    from fastmcp import Client

    mcp_server._register_order_tools()

    async def go():
        async with Client(mcp_server.mcp) as c:
            return await c.call_tool(
                "trading_place_order", {"symbol": "AAPL", "side": "short", "quantity": 1}, raise_on_error=False
            )

    res = asyncio.run(go())
    assert res.is_error
    assert fake_registry.calls == []


@pytest.mark.parametrize(
    "val,expected", [("1", True), ("true", True), ("yes", True), ("0", False), ("", False), ("no", False)]
)
def test_env_switch_values(monkeypatch, val, expected):
    monkeypatch.setenv("VIBE_CRYPTO_MCP_ENABLE_ORDERS", val)
    reset_env_config()
    assert mcp_server._resolve_include_order_tools(False) is expected


def test_cli_opt_in_wins_over_env_off(monkeypatch):
    monkeypatch.setenv("VIBE_CRYPTO_MCP_ENABLE_ORDERS", "0")
    reset_env_config()
    assert mcp_server._resolve_include_order_tools(True) is True


# ---------------------------------------------------------------------------
# Config surface: env schema, .env.example, chat panel, settings API
# ---------------------------------------------------------------------------


def test_env_schema_defaults(monkeypatch):
    from src.config.accessor import get_env_config

    api = get_env_config().api
    assert api.vibe_crypto_mcp_token == ""
    assert api.vibe_crypto_mcp_enable_orders is False
    monkeypatch.setenv("VIBE_CRYPTO_MCP_TOKEN", TOK)
    reset_env_config()
    assert get_env_config().api.vibe_crypto_mcp_token == TOK


def test_env_example_documents_both_keys_commented():
    text = (AGENT_DIR / ".env.example").read_text(encoding="utf-8")
    lines = text.splitlines()
    assert "# VIBE_CRYPTO_MCP_TOKEN=" in lines
    assert "# VIBE_CRYPTO_MCP_ENABLE_ORDERS=0" in lines
    assert not any(re.match(r"\s*VIBE_CRYPTO_MCP_", ln) for ln in lines), "must stay commented"
    assert "token_urlsafe" in text and "NOT read" in text


def test_chat_panel_pins_orders_off_and_has_no_token():
    from src.claude_chat import service

    env = service.mcp_server_config()["env"]
    assert env["VIBE_CRYPTO_MCP_ENABLE_ORDERS"] == "0"
    assert env.get("PYTHONUNBUFFERED") == "1"
    assert "VIBE_CRYPTO_MCP_TOKEN" not in env


def test_no_api_module_mentions_new_keys():
    hits = []
    for path in (AGENT_DIR / "src" / "api").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "VIBE_CRYPTO_MCP_" in text or "vibe_crypto_mcp_" in text:
            hits.append(str(path.relative_to(REPO)))
    assert hits == []


def test_frontend_never_mentions_new_keys():
    hits = []
    src_dir = REPO / "frontend" / "src"
    if not src_dir.is_dir():
        pytest.skip("frontend/src missing")
    for path in src_dir.rglob("*"):
        if path.suffix in {".ts", ".tsx", ".js", ".jsx"} and path.is_file():
            if "VIBE_CRYPTO_MCP_" in path.read_text(encoding="utf-8", errors="ignore"):
                hits.append(str(path.relative_to(REPO)))
    assert hits == []


# ---------------------------------------------------------------------------
# Handoff doc
# ---------------------------------------------------------------------------


def test_handoff_doc_lists_flags_env_and_urls():
    path = REPO / "docs" / "vibe-crypto" / "handoff" / "T15.md"
    assert path.is_file()
    text = path.read_text(encoding="utf-8")
    for needle in (
        "--token",
        "--allowed-hosts",
        "--enable-order-tools",
        "VIBE_CRYPTO_MCP_TOKEN",
        "VIBE_CRYPTO_MCP_ENABLE_ORDERS",
        "/<token>/mcp",
        "/<token>/sse",
        "Authorization: Bearer",
    ):
        assert needle in text, needle
    assert "—" not in text, "no em dashes"
