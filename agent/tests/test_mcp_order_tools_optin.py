"""Opt-in order tools over MCP (ADR 0008)."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import mcp_server
import pytest
from fastmcp import Client
from src.config.accessor import reset_env_config

ORDER_TOOLS = {"trading_place_order", "trading_cancel_order"}
SERVER = Path(mcp_server.__file__).resolve()


async def _tools(target) -> list:
    async with Client(target) as c:
        return await c.list_tools()


@pytest.fixture(autouse=True)
def _clean():
    reset_env_config()
    yield
    mcp_server._unregister_order_tools()
    reset_env_config()


def test_default_has_no_order_tools():
    names = {t.name for t in asyncio.run(_tools(mcp_server.mcp))}
    assert not names & ORDER_TOOLS


def test_resolve(monkeypatch):
    monkeypatch.delenv("VIBE_CRYPTO_MCP_ENABLE_ORDERS", raising=False)
    reset_env_config()
    assert mcp_server._resolve_include_order_tools(False) is False
    assert mcp_server._resolve_include_order_tools(True) is True
    for val, expected in (("1", True), ("false", False), ("0", False)):
        monkeypatch.setenv("VIBE_CRYPTO_MCP_ENABLE_ORDERS", val)
        reset_env_config()
        assert mcp_server._resolve_include_order_tools(False) is expected


def test_register_and_call(monkeypatch):
    import src.tools.trading_connector_tool as tct

    seen: dict = {}

    def fake_place(symbol, profile, **kw):
        seen["place"] = {"symbol": symbol, "profile": profile, **kw}
        return {"status": "ok", "order_id": "X1"}

    def fake_cancel(*a, **kw):
        seen["cancel"] = (a, kw)
        return {"status": "ok", "order_id": "X1"}

    monkeypatch.setattr(tct, "place_order", fake_place)
    monkeypatch.setattr(tct, "cancel_order", fake_cancel)
    mcp_server._register_order_tools()
    mcp_server._register_order_tools()
    tools = asyncio.run(_tools(mcp_server.mcp))
    for name in ORDER_TOOLS:
        matches = [t for t in tools if t.name == name]
        assert len(matches) == 1
        ann = matches[0].annotations
        assert ann.destructiveHint is True and ann.readOnlyHint is False

    async def go():
        async with Client(mcp_server.mcp) as c:
            r1 = await c.call_tool(
                "trading_place_order",
                {"symbol": "AAPL", "side": "buy", "quantity": 1, "connection": "alpaca-paper-trade"},
            )
            r2 = await c.call_tool("trading_cancel_order", {"order_id": "X1"})
            return r1, r2

    r1, r2 = asyncio.run(go())
    assert "X1" in json.dumps(r1.content[0].text)
    assert seen["place"]["symbol"] == "AAPL" and seen["place"]["side"] == "buy"
    assert seen["place"]["quantity"] == 1.0
    assert "alpaca-paper-trade" in json.dumps(seen["place"], default=str)
    assert "cancel" in seen


def test_chat_config_pins_orders_off():
    from src.claude_chat import service

    assert service.mcp_server_config()["env"]["VIBE_CRYPTO_MCP_ENABLE_ORDERS"] == "0"


def test_settings_api_never_touches_new_keys():
    src = (Path(__file__).resolve().parents[1] / "src" / "api" / "settings_routes.py").read_text()
    assert "VIBE_CRYPTO_MCP_TOKEN" not in src and "VIBE_CRYPTO_MCP_ENABLE_ORDERS" not in src


@pytest.mark.integration
def test_dotenv_cannot_enable_orders(tmp_path):
    from fastmcp.client.transports import StdioTransport

    (tmp_path / ".vibe-trading").mkdir()
    (tmp_path / ".vibe-trading" / ".env").write_text("VIBE_CRYPTO_MCP_ENABLE_ORDERS=1\n")
    base = {k: v for k, v in os.environ.items() if not k.startswith("VIBE_CRYPTO_MCP")}
    base["HOME"] = str(tmp_path)

    def names(env):
        t = StdioTransport(command=sys.executable, args=[str(SERVER)], env=env)
        return {x.name for x in asyncio.run(_tools(t))}

    assert "trading_place_order" not in names(base)
    assert "trading_place_order" in names({**base, "VIBE_CRYPTO_MCP_ENABLE_ORDERS": "1"})
