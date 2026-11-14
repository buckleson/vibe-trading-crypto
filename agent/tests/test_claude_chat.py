"""Claude chat service tests. The SDK is fully mocked; no real API calls."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    CLINotFoundError,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from src.claude_chat import service


def _collect(message="hi", session_id=None):
    async def run():
        return [e async for e in service.stream_chat(message, session_id, None)]

    return asyncio.run(run())


def test_build_options():
    opts = service.build_options("abc-123", None)
    assert opts.tools == []
    assert opts.allowed_tools == ["mcp__vibe-crypto"]
    assert opts.permission_mode == "dontAsk"
    assert opts.setting_sources == []
    assert opts.include_partial_messages is True
    assert opts.resume == "abc-123"
    cfg = opts.mcp_servers["vibe-crypto"]
    assert cfg["command"] == sys.executable
    assert cfg["args"][0].endswith("mcp_server.py")
    assert Path(cfg["args"][0]).exists()
    assert service.build_options(None, None).resume is None


def test_status_api_key(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    s = service.claude_status()
    assert s["available"] is True and s["auth"] == "api_key" and s["sdk_version"]


def test_status_login_and_unknown(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert service.claude_status()["auth"] == "unknown"
    (tmp_path / ".claude").mkdir()
    assert service.claude_status()["auth"] == "claude_login"


def _delta(text):
    return StreamEvent(
        uuid="u", session_id="s", parent_tool_use_id=None,
        event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}},
    )


def test_stream_mapping(monkeypatch):
    async def fake(prompt, options):
        yield SystemMessage(subtype="init", data={"session_id": "sess-1"})
        yield _delta("Hel")
        yield _delta("lo")
        yield AssistantMessage(
            content=[
                TextBlock(text="Hello"),
                ToolUseBlock(id="t1", name="mcp__vibe-crypto__list_backtest_runs", input={"limit": 3}),
            ],
            model="m", parent_tool_use_id=None,
        )
        yield UserMessage(
            content=[ToolResultBlock(tool_use_id="t1", content=[{"type": "text", "text": "runs: 2"}], is_error=False)],
            parent_tool_use_id=None,
        )
        yield ResultMessage(
            subtype="success", duration_ms=5, duration_api_ms=4, is_error=False, num_turns=1,
            session_id="sess-1", total_cost_usd=0.01,
        )

    monkeypatch.setattr(service, "_query", fake)
    events = _collect()
    assert [e["type"] for e in events] == ["session", "text", "text", "tool_use", "tool_result", "done"]
    assert "".join(e["delta"] for e in events if e["type"] == "text") == "Hello"
    assert events[3]["name"] == "list_backtest_runs"
    assert events[4]["preview"] == "runs: 2"
    assert events[5]["cost_usd"] == 0.01


def test_text_fallback_without_partials(monkeypatch):
    async def fake(prompt, options):
        yield AssistantMessage(content=[TextBlock(text="Whole")], model="m", parent_tool_use_id=None)

    monkeypatch.setattr(service, "_query", fake)
    assert _collect() == [{"type": "text", "delta": "Whole"}]


def test_cli_not_found(monkeypatch):
    async def fake(prompt, options):
        raise CLINotFoundError("nope")
        yield  # pragma: no cover

    monkeypatch.setattr(service, "_query", fake)
    events = _collect()
    assert len(events) == 1 and events[0]["type"] == "error"


def test_other_exception_does_not_raise(monkeypatch):
    async def fake(prompt, options):
        raise RuntimeError("boom")
        yield  # pragma: no cover

    monkeypatch.setattr(service, "_query", fake)
    assert _collect() == [{"type": "error", "message": "boom"}]
