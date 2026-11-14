"""T06 acceptance tests: Claude chat via the Claude Agent SDK.

Offline and deterministic. The SDK is never called for real: every chat test
replaces ``src.claude_chat.service._query`` (or ``claude_agent_sdk.query``) with
a fake async generator that yields real SDK dataclass instances.
"""

from __future__ import annotations

import asyncio
import importlib.metadata
import json
import re
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Import api_server at module top so its import-time paths stay on the conftest sandbox.
import api_server
import claude_agent_sdk
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    CLINotFoundError,
    ProcessError,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from src.api import claude_chat_routes
from src.claude_chat import service

REPO = Path(__file__).resolve().parents[3]
NOT_AVAILABLE = (
    "Claude Code is not available. Reinstall the app dependencies "
    "(pip install -e .) or install Claude Code."
)
STATUS_KEYS = {"available", "sdk_version", "auth", "model", "error"}


# --------------------------------------------------------------------------- helpers


def delta(text: str, parent: str | None = None, kind: str = "text_delta") -> StreamEvent:
    d = {"type": kind, "text": text} if kind == "text_delta" else {"type": kind, "partial_json": text}
    return StreamEvent(uuid="u", session_id="s", parent_tool_use_id=parent,
                       event={"type": "content_block_delta", "index": 0, "delta": d})


def assistant(*blocks, parent: str | None = None) -> AssistantMessage:
    return AssistantMessage(content=list(blocks), model="claude-test", parent_tool_use_id=parent)


def result(*, is_error=False, text=None, session="sess-1", cost=0.02, ms=1234) -> ResultMessage:
    return ResultMessage(subtype="error_during_execution" if is_error else "success",
                         duration_ms=ms, duration_api_ms=ms, is_error=is_error, num_turns=1,
                         session_id=session, total_cost_usd=cost, result=text)


def fake_query(*messages, raise_after: BaseException | None = None, seen: list | None = None):
    async def fake(prompt, options):
        if seen is not None:
            seen.append((prompt, options))
        for m in messages:
            yield m
        if raise_after is not None:
            raise raise_after

    return fake


def collect(monkeypatch, *messages, raise_after=None, message="hi", session_id=None, model=None, seen=None):
    monkeypatch.setattr(service, "_query", fake_query(*messages, raise_after=raise_after, seen=seen))

    async def run():
        return [e async for e in service.stream_chat(message, session_id, model)]

    return asyncio.run(run())


def types_of(events):
    return [e["type"] for e in events]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    monkeypatch.delenv("VIBE_CRYPTO_CLAUDE_MODEL", raising=False)
    monkeypatch.setattr(service, "get_runtime_root", lambda: tmp_path / "runtime")


@pytest.fixture()
def client():
    return TestClient(api_server.app, base_url="http://127.0.0.1:8899")


# --------------------------------------------------------------------------- constants


def test_constants():
    assert service.SERVER_NAME == "vibe-crypto"
    assert service.TOOL_PREFIX == "mcp__vibe-crypto__"


def test_system_prompt_content():
    p = service.SYSTEM_PROMPT
    assert isinstance(p, str)
    assert p.startswith("You are Claude inside Vibe Crypto")
    assert "You cannot place live orders." in p
    assert "never invent data you did not get from a tool" in p
    assert "—" not in p and "–" not in p


# --------------------------------------------------------------------------- mcp_server_config


def test_mcp_config_shape_and_real_path():
    cfg = service.mcp_server_config()
    assert set(cfg) == {"type", "command", "args", "env"}
    assert cfg["type"] == "stdio"
    assert cfg["command"] == sys.executable
    assert len(cfg["args"]) == 1
    path = Path(cfg["args"][0])
    assert path.name == "mcp_server.py" and path.is_file()
    assert path.resolve() == (REPO / "agent" / "mcp_server.py").resolve()
    assert cfg["env"] == {"PYTHONUNBUFFERED": "1"}


def test_mcp_config_uses_find_spec_origin(monkeypatch, tmp_path):
    fake = tmp_path / "elsewhere" / "mcp_server.py"
    monkeypatch.setattr(service.importlib.util, "find_spec",
                        lambda name: types.SimpleNamespace(origin=str(fake)) if name == "mcp_server" else None)
    assert service.mcp_server_config()["args"] == [str(fake)]


@pytest.mark.parametrize("behaviour", ["none", "no_origin", "import_error", "value_error"])
def test_mcp_config_falls_back_to_agent_dir(monkeypatch, behaviour):
    def find_spec(name):
        if behaviour == "none":
            return None
        if behaviour == "no_origin":
            return types.SimpleNamespace(origin=None)
        if behaviour == "import_error":
            raise ImportError("x")
        raise ValueError("x")

    monkeypatch.setattr(service.importlib.util, "find_spec", find_spec)
    path = Path(service.mcp_server_config()["args"][0])
    assert path == Path(service.__file__).resolve().parents[2] / "mcp_server.py"
    assert path.is_file()


def test_mcp_config_does_not_import_mcp_server(monkeypatch):
    monkeypatch.delitem(sys.modules, "mcp_server", raising=False)
    service.mcp_server_config()
    assert "mcp_server" not in sys.modules


# --------------------------------------------------------------------------- build_options


def test_build_options_fields(tmp_path):
    opts = service.build_options("abc-123", None)
    assert isinstance(opts, ClaudeAgentOptions)
    assert opts.system_prompt == service.SYSTEM_PROMPT
    assert list(opts.mcp_servers) == ["vibe-crypto"]
    assert opts.mcp_servers["vibe-crypto"] == service.mcp_server_config()
    assert opts.tools == []
    assert opts.allowed_tools == ["mcp__vibe-crypto"]
    assert opts.permission_mode == "dontAsk"
    assert opts.setting_sources == []
    assert opts.include_partial_messages is True
    assert opts.resume == "abc-123"
    assert opts.max_turns == 30
    assert opts.model is None


def test_build_options_cwd_created(tmp_path):
    expected = tmp_path / "runtime" / "claude-chat"
    assert not expected.exists()
    opts = service.build_options(None, None)
    assert Path(opts.cwd) == expected
    assert expected.is_dir()
    # Idempotent on a second call.
    assert Path(service.build_options(None, None).cwd) == expected


@pytest.mark.parametrize("sid, expected", [(None, None), ("", None), ("s-1", "s-1")])
def test_build_options_resume(sid, expected):
    assert service.build_options(sid, None).resume == expected


@pytest.mark.parametrize("arg, env, expected", [
    (None, None, None),
    ("", None, None),
    (None, "", None),
    (None, "claude-env", "claude-env"),
    ("claude-arg", "claude-env", "claude-arg"),
    ("claude-arg", None, "claude-arg"),
])
def test_build_options_model_precedence(monkeypatch, arg, env, expected):
    if env is not None:
        monkeypatch.setenv("VIBE_CRYPTO_CLAUDE_MODEL", env)
    assert service.build_options(None, arg).model == expected


def test_build_options_never_enables_builtin_or_bypass():
    opts = service.build_options(None, None)
    assert opts.permission_mode != "bypassPermissions"
    for t in opts.allowed_tools:
        assert t.startswith("mcp__vibe-crypto")
    assert not opts.disallowed_tools or all(isinstance(t, str) for t in opts.disallowed_tools)


# --------------------------------------------------------------------------- claude_status


@pytest.fixture()
def no_auth(monkeypatch, tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    return home


def test_status_unknown(no_auth):
    s = service.claude_status()
    assert set(s) == STATUS_KEYS
    assert s == {"available": True, "sdk_version": importlib.metadata.version("claude-agent-sdk"),
                 "auth": "unknown", "model": None, "error": None}


def test_status_api_key(no_auth, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert service.claude_status()["auth"] == "api_key"


def test_status_auth_token(no_auth, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok")
    assert service.claude_status()["auth"] == "api_key"


def test_status_empty_key_is_not_a_key(no_auth, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    assert service.claude_status()["auth"] == "unknown"


def test_status_login(no_auth):
    (no_auth / ".claude").mkdir()
    assert service.claude_status()["auth"] == "claude_login"


def test_status_key_beats_login(no_auth, monkeypatch):
    (no_auth / ".claude").mkdir()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert service.claude_status()["auth"] == "api_key"


def test_status_model_from_env(no_auth, monkeypatch):
    monkeypatch.setenv("VIBE_CRYPTO_CLAUDE_MODEL", "claude-x")
    assert service.claude_status()["model"] == "claude-x"


def test_status_sdk_missing(no_auth, monkeypatch):
    real = service.importlib.util.find_spec
    monkeypatch.setattr(service.importlib.util, "find_spec",
                        lambda name: None if name == "claude_agent_sdk" else real(name))
    s = service.claude_status()
    assert s["available"] is False
    assert s["sdk_version"] is None
    assert s["error"] == NOT_AVAILABLE


def test_status_version_metadata_missing(no_auth, monkeypatch):
    def boom(name):
        raise importlib.metadata.PackageNotFoundError(name)

    monkeypatch.setattr(service.importlib.metadata, "version", boom)
    s = service.claude_status()
    assert s["available"] is True and s["sdk_version"] is None and s["error"] is None


def test_status_never_spawns_processes(no_auth, monkeypatch):
    import subprocess

    def forbid(*a, **k):
        raise AssertionError("claude_status must not spawn processes")

    monkeypatch.setattr(subprocess, "Popen", forbid)
    monkeypatch.setattr(subprocess, "run", forbid)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", forbid)
    assert service.claude_status()["available"] is True


# --------------------------------------------------------------------------- _query


def test_query_delegates_to_sdk(monkeypatch):
    seen = {}

    async def fake(*, prompt, options):
        seen["prompt"], seen["options"] = prompt, options
        yield SystemMessage(subtype="init", data={"session_id": "x"})

    monkeypatch.setattr(claude_agent_sdk, "query", fake)
    opts = object()

    async def run():
        return [m async for m in service._query("hello", opts)]

    out = asyncio.run(run())
    assert len(out) == 1 and isinstance(out[0], SystemMessage)
    assert seen == {"prompt": "hello", "options": opts}


# --------------------------------------------------------------------------- _result_text


@pytest.mark.parametrize("content, expected", [
    ("plain", "plain"),
    ("", ""),
    (None, ""),
    ([], ""),
    ([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}], "ab"),
    ([{"type": "image", "source": {}}, {"type": "text", "text": "c"}], "c"),
    (["not-a-dict", {"type": "text", "text": "d"}], "d"),
    ([{"type": "text", "text": 5}], "5"),
    (42, ""),
])
def test_result_text(content, expected):
    assert service._result_text(content) == expected


@pytest.mark.parametrize("n", [1999, 2000, 2001, 5000])
def test_result_text_truncation(n):
    assert len(service._result_text("x" * n)) == min(n, 2000)
    assert len(service._result_text([{"type": "text", "text": "y" * n}])) == min(n, 2000)


# --------------------------------------------------------------------------- stream_chat mapping


def test_stream_full_turn(monkeypatch):
    events = collect(
        monkeypatch,
        SystemMessage(subtype="init", data={"session_id": "sess-1", "tools": []}),
        delta("Let me "),
        delta("check."),
        assistant(TextBlock(text="Let me check."),
                  ToolUseBlock(id="t1", name="mcp__vibe-crypto__list_backtest_runs", input={"limit": 3})),
        UserMessage(content=[ToolResultBlock(tool_use_id="t1",
                                             content=[{"type": "text", "text": "2 runs"}], is_error=False)]),
        delta("You have "),
        delta("2 runs."),
        assistant(TextBlock(text="You have 2 runs.")),
        result(),
    )
    assert events == [
        {"type": "session", "session_id": "sess-1"},
        {"type": "text", "delta": "Let me "},
        {"type": "text", "delta": "check."},
        {"type": "tool_use", "id": "t1", "name": "list_backtest_runs", "input": {"limit": 3}},
        {"type": "tool_result", "tool_use_id": "t1", "is_error": False, "preview": "2 runs"},
        {"type": "text", "delta": "You have "},
        {"type": "text", "delta": "2 runs."},
        {"type": "done", "session_id": "sess-1", "is_error": False, "cost_usd": 0.02, "duration_ms": 1234},
    ]
    for e in events:
        json.dumps(e)


def test_stream_fallback_text_when_no_partials(monkeypatch):
    events = collect(monkeypatch, assistant(TextBlock(text="A"), TextBlock(text="B")), result())
    assert [e["delta"] for e in events if e["type"] == "text"] == ["A", "B"]


def test_stream_flag_resets_per_assistant_message(monkeypatch):
    events = collect(
        monkeypatch,
        delta("one"),
        assistant(TextBlock(text="one")),
        assistant(TextBlock(text="two")),  # no deltas before this turn -> fallback
        delta("three"),
        assistant(TextBlock(text="three")),
    )
    assert [e["delta"] for e in events] == ["one", "two", "three"]


def test_stream_subagent_deltas_ignored_and_do_not_suppress(monkeypatch):
    events = collect(monkeypatch, delta("inner", parent="tool-9"), assistant(TextBlock(text="outer")))
    assert events == [{"type": "text", "delta": "outer"}]


@pytest.mark.parametrize("event", [
    {"type": "message_start", "message": {}},
    {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "{"}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "hmm"}},
    {"type": "content_block_stop", "index": 0},
    {"type": "message_stop"},
    {},
])
def test_stream_non_text_stream_events_ignored(monkeypatch, event):
    se = StreamEvent(uuid="u", session_id="s", event=event, parent_tool_use_id=None)
    events = collect(monkeypatch, se, assistant(TextBlock(text="T")))
    assert events == [{"type": "text", "delta": "T"}]


def test_stream_empty_text_delta_passes_through(monkeypatch):
    se = StreamEvent(uuid="u", session_id="s", parent_tool_use_id=None,
                     event={"type": "content_block_delta", "delta": {"type": "text_delta"}})
    assert collect(monkeypatch, se) == [{"type": "text", "delta": ""}]


def test_stream_subagent_assistant_message_skipped(monkeypatch):
    events = collect(
        monkeypatch,
        delta("hi"),
        assistant(TextBlock(text="sub"), ToolUseBlock(id="x", name="mcp__vibe-crypto__a", input={}),
                  parent="tool-1"),
        assistant(TextBlock(text="hi")),
    )
    assert events == [{"type": "text", "delta": "hi"}]


@pytest.mark.parametrize("raw, shown", [
    ("mcp__vibe-crypto__run_backtest", "run_backtest"),
    ("mcp__vibe-crypto__", ""),
    ("list_runs", "list_runs"),
    ("mcp__other__thing", "mcp__other__thing"),
    ("prefix_mcp__vibe-crypto__x", "prefix_mcp__vibe-crypto__x"),
])
def test_stream_tool_name_prefix_stripping(monkeypatch, raw, shown):
    events = collect(monkeypatch, assistant(ToolUseBlock(id="t", name=raw, input={"a": [1, 2]})))
    assert events == [{"type": "tool_use", "id": "t", "name": shown, "input": {"a": [1, 2]}}]


def test_stream_thinking_blocks_ignored(monkeypatch):
    events = collect(monkeypatch, assistant(ThinkingBlock(thinking="secret", signature="sig"),
                                            TextBlock(text="answer")))
    assert events == [{"type": "text", "delta": "answer"}]


def test_stream_multiple_tool_uses_in_one_message(monkeypatch):
    events = collect(monkeypatch, assistant(
        ToolUseBlock(id="a", name="mcp__vibe-crypto__one", input={}),
        ToolUseBlock(id="b", name="mcp__vibe-crypto__two", input={}),
    ), UserMessage(content=[
        ToolResultBlock(tool_use_id="b", content="B"),
        ToolResultBlock(tool_use_id="a", content="A", is_error=True),
    ]))
    assert events == [
        {"type": "tool_use", "id": "a", "name": "one", "input": {}},
        {"type": "tool_use", "id": "b", "name": "two", "input": {}},
        {"type": "tool_result", "tool_use_id": "b", "is_error": False, "preview": "B"},
        {"type": "tool_result", "tool_use_id": "a", "is_error": True, "preview": "A"},
    ]


@pytest.mark.parametrize("data", [{"session_id": None}, {}, {"session_id": ""}])
def test_stream_init_without_session_ignored(monkeypatch, data):
    assert collect(monkeypatch, SystemMessage(subtype="init", data=data)) == []


def test_stream_non_init_system_ignored(monkeypatch):
    assert collect(monkeypatch, SystemMessage(subtype="compact_boundary", data={"session_id": "z"})) == []


def test_stream_user_string_content_ignored(monkeypatch):
    assert collect(monkeypatch, UserMessage(content="echo of the prompt")) == []


def test_stream_user_text_blocks_ignored(monkeypatch):
    assert collect(monkeypatch, UserMessage(content=[TextBlock(text="x")])) == []


@pytest.mark.parametrize("content, is_error, preview, err", [
    (None, None, "", False),
    ("ok", None, "ok", False),
    ("bad", True, "bad", True),
    ("fine", False, "fine", False),
    ("z" * 3000, False, "z" * 2000, False),
    ([{"type": "text", "text": "q" * 2500}], False, "q" * 2000, False),
])
def test_stream_tool_result_variants(monkeypatch, content, is_error, preview, err):
    events = collect(monkeypatch, UserMessage(content=[ToolResultBlock(tool_use_id="t", content=content,
                                                                       is_error=is_error)]))
    assert events == [{"type": "tool_result", "tool_use_id": "t", "is_error": err, "preview": preview}]
    assert events[0]["is_error"] is err


def test_stream_result_error_with_text(monkeypatch):
    events = collect(monkeypatch, result(is_error=True, text="Rate limited", cost=None, ms=7))
    assert events == [
        {"type": "error", "message": "Rate limited"},
        {"type": "done", "session_id": "sess-1", "is_error": True, "cost_usd": None, "duration_ms": 7},
    ]


def test_stream_result_error_without_text(monkeypatch):
    events = collect(monkeypatch, result(is_error=True, text=None))
    assert types_of(events) == ["done"] and events[0]["is_error"] is True


def test_stream_result_error_text_truncated(monkeypatch):
    events = collect(monkeypatch, result(is_error=True, text="e" * 900))
    assert events[0]["type"] == "error" and len(events[0]["message"]) == 500


def test_stream_result_success_text_not_error(monkeypatch):
    events = collect(monkeypatch, result(is_error=False, text="final answer"))
    assert types_of(events) == ["done"]


def test_stream_empty(monkeypatch):
    assert collect(monkeypatch) == []


def test_stream_unknown_message_types_ignored(monkeypatch):
    assert collect(monkeypatch, object(), {"type": "x"}, "str") == []


# --------------------------------------------------------------------------- stream_chat errors


def test_stream_cli_not_found(monkeypatch):
    events = collect(monkeypatch, raise_after=CLINotFoundError("Claude Code not found"))
    assert events == [{"type": "error", "message": NOT_AVAILABLE}]


def test_stream_error_after_partial_output_keeps_prior_events(monkeypatch):
    events = collect(monkeypatch, SystemMessage(subtype="init", data={"session_id": "s"}), delta("par"),
                     raise_after=ProcessError("exit 1", exit_code=1, stderr="bad"))
    assert types_of(events) == ["session", "text", "error"]
    assert "exit 1" in events[-1]["message"]


def test_stream_generic_error_truncated(monkeypatch):
    events = collect(monkeypatch, raise_after=RuntimeError("b" * 1000))
    assert events == [{"type": "error", "message": "b" * 500}]


def test_stream_build_options_failure_becomes_error(monkeypatch):
    def boom(*a):
        raise OSError("disk full")

    monkeypatch.setattr(service, "build_options", boom)
    events = collect(monkeypatch)
    assert events == [{"type": "error", "message": "disk full"}]


def test_stream_sdk_not_importable(monkeypatch):
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)

    async def run():
        return [e async for e in service.stream_chat("hi", None, None)]

    assert asyncio.run(run()) == [{"type": "error", "message": NOT_AVAILABLE}]


def test_stream_passes_prompt_session_and_model(monkeypatch):
    seen: list = []
    collect(monkeypatch, message="What runs?", session_id="sess-9", model="claude-m", seen=seen)
    (prompt, opts), = seen
    assert prompt == "What runs?"
    assert opts.resume == "sess-9" and opts.model == "claude-m"
    assert opts.allowed_tools == ["mcp__vibe-crypto"] and opts.tools == []


# --------------------------------------------------------------------------- routes


def _sse_blocks(text: str):
    blocks = [b for b in text.split("\n\n") if b.strip()]
    out = []
    for b in blocks:
        lines = b.split("\n")
        assert len(lines) == 2, b
        assert lines[0].startswith("event: ") and lines[1].startswith("data: ")
        name = lines[0][len("event: "):]
        data = json.loads(lines[1][len("data: "):])
        assert data["type"] == name
        out.append(data)
    return out


def test_routes_registered():
    seen = {(r.path, m) for r in api_server.app.routes for m in getattr(r, "methods", set()) or set()}
    assert ("/api/claude/status", "GET") in seen
    assert ("/api/claude/chat", "POST") in seen


def test_route_status(client, monkeypatch):
    monkeypatch.setattr(service, "claude_status",
                        lambda: {"available": False, "sdk_version": None, "auth": "unknown",
                                 "model": None, "error": "nope"})
    r = client.get("/api/claude/status")
    assert r.status_code == 200
    assert r.json() == {"available": False, "sdk_version": None, "auth": "unknown", "model": None,
                        "error": "nope"}


def test_route_status_real_shape(client):
    body = client.get("/api/claude/status").json()
    assert set(body) == STATUS_KEYS
    assert body["available"] is True
    assert body["auth"] in {"api_key", "claude_login", "unknown"}


def test_route_chat_sse_format_and_headers(client, monkeypatch):
    calls = []

    async def fake(message, session_id, model):
        calls.append((message, session_id, model))
        yield {"type": "session", "session_id": "s1"}
        yield {"type": "text", "delta": "Prix élevé ₿\nline2"}
        yield {"type": "tool_use", "id": "t", "name": "x", "input": {"k": "v"}}
        yield {"type": "tool_result", "tool_use_id": "t", "is_error": False, "preview": "ok"}
        yield {"type": "done", "session_id": "s1", "is_error": False, "cost_usd": 0.1, "duration_ms": 5}

    monkeypatch.setattr(service, "stream_chat", fake)
    r = client.post("/api/claude/chat", json={"message": "  hello  ", "session_id": "abc-DEF-1",
                                              "model": "claude-m"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-accel-buffering"] == "no"
    assert calls == [("hello", "abc-DEF-1", "claude-m")]
    assert "₿" in r.text  # ensure_ascii=False
    assert "\\n" in r.text  # newline inside data is JSON-escaped, never a raw SSE break
    events = _sse_blocks(r.text)
    assert types_of(events) == ["session", "text", "tool_use", "tool_result", "done"]
    assert events[1]["delta"] == "Prix élevé ₿\nline2"


def test_route_chat_defaults_none(client, monkeypatch):
    calls = []

    async def fake(message, session_id, model):
        calls.append((message, session_id, model))
        if False:
            yield {}

    monkeypatch.setattr(service, "stream_chat", fake)
    r = client.post("/api/claude/chat", json={"message": "x", "session_id": None, "model": None})
    assert r.status_code == 200 and r.text == ""
    assert calls == [("x", None, None)]


def test_route_chat_end_to_end_with_fake_sdk(client, monkeypatch):
    monkeypatch.setattr(service, "_query", fake_query(
        SystemMessage(subtype="init", data={"session_id": "e2e"}),
        delta("Hi"),
        assistant(TextBlock(text="Hi"), ToolUseBlock(id="t1", name="mcp__vibe-crypto__list_paper_runs", input={})),
        UserMessage(content=[ToolResultBlock(tool_use_id="t1", content="[]")]),
        result(session="e2e"),
    ))
    r = client.post("/api/claude/chat", json={"message": "runs?"})
    events = _sse_blocks(r.text)
    assert types_of(events) == ["session", "text", "tool_use", "tool_result", "done"]
    assert events[2]["name"] == "list_paper_runs"
    assert events[-1]["session_id"] == "e2e"


def test_route_chat_cli_missing_is_200_with_error_event(client, monkeypatch):
    monkeypatch.setattr(service, "_query", fake_query(raise_after=CLINotFoundError()))
    r = client.post("/api/claude/chat", json={"message": "hi"})
    assert r.status_code == 200
    assert _sse_blocks(r.text) == [{"type": "error", "message": NOT_AVAILABLE}]


@pytest.mark.parametrize("body", [
    {},
    {"message": ""},
    {"message": " \n\t "},
    {"message": None},
    {"message": 5},
    {"message": ["a"]},
    {"message": "x" * 20001},
    {"message": "x", "session_id": ""},
    {"message": "x", "session_id": "a" * 101},
    {"message": "x", "session_id": "has space"},
    {"message": "x", "session_id": "under_score"},
    {"message": "x", "session_id": "../etc"},
    {"message": "x", "session_id": "abc\n"},
    {"message": "x", "session_id": 123},
    {"message": "x", "model": "m" * 101},
    {"message": "x", "unexpected": True},
    {"message": "x", "sessionId": "abc"},
])
def test_route_chat_validation_422(client, monkeypatch, body):
    async def never(*a):
        raise AssertionError("stream_chat must not run on invalid input")
        yield  # pragma: no cover

    monkeypatch.setattr(service, "stream_chat", never)
    assert client.post("/api/claude/chat", json=body).status_code == 422


@pytest.mark.parametrize("body", [
    {"message": "x" * 20000},
    {"message": "x", "session_id": "a" * 100},
    {"message": "x", "session_id": "0f8fad5b-d9cb-469f-a165-70867728950e"},
    {"message": "x", "model": "m" * 100},
    {"message": "x", "model": ""},
])
def test_route_chat_validation_boundaries_ok(client, monkeypatch, body):
    async def fake(*a):
        yield {"type": "done", "session_id": None, "is_error": False, "cost_usd": None, "duration_ms": 0}

    monkeypatch.setattr(service, "stream_chat", fake)
    assert client.post("/api/claude/chat", json=body).status_code == 200


def test_route_chat_non_json_body_422(client):
    r = client.post("/api/claude/chat", content="hello", headers={"content-type": "text/plain"})
    assert r.status_code == 422


def test_chat_request_model_strips():
    assert claude_chat_routes.ChatRequest(message="  hi \n").message == "hi"


@pytest.mark.parametrize("headers", [
    {"Origin": "https://evil.example"},
    {"Origin": "http://192.0.2.10:5173"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_route_chat_cross_site_rejected(client, monkeypatch, headers):
    async def never(*a):
        raise AssertionError("must not stream")
        yield  # pragma: no cover

    monkeypatch.setattr(service, "stream_chat", never)
    r = client.post("/api/claude/chat", json={"message": "hi"}, headers=headers)
    assert r.status_code == 403


@pytest.mark.parametrize("headers", [
    {"Origin": "http://localhost:5173"},
    {"Origin": "http://127.0.0.1:8899"},
    {"Sec-Fetch-Site": "same-origin"},
    {},
])
def test_route_chat_local_origins_allowed(client, monkeypatch, headers):
    async def fake(*a):
        yield {"type": "text", "delta": "ok"}

    monkeypatch.setattr(service, "stream_chat", fake)
    assert client.post("/api/claude/chat", json={"message": "hi"}, headers=headers).status_code == 200


def test_routes_reject_non_local_peer(monkeypatch):
    remote = TestClient(api_server.app, base_url="http://127.0.0.1:8899", client=("203.0.113.7", 40000))
    assert remote.get("/api/claude/status").status_code == 403
    assert remote.post("/api/claude/chat", json={"message": "hi"}).status_code == 403


def test_route_chat_get_not_allowed(client):
    response = client.get("/api/claude/chat")
    if response.status_code == 200:
        # SPA mounted at "/" by another test serves index.html for GET.
        assert response.headers["content-type"].startswith("text/html")
        return
    assert response.status_code == 405


# --------------------------------------------------------------------------- dependency declarations


def test_dependency_declared_in_pyproject():
    text = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    deps = text.split("dependencies", 1)[1].split("]", 1)[0]
    assert '"claude-agent-sdk>=0.2.172,<0.3"' in deps


def test_dependency_declared_in_requirements():
    lines = [ln.strip() for ln in (REPO / "agent" / "requirements.txt").read_text().splitlines()]
    assert "claude-agent-sdk>=0.2.172,<0.3" in lines


def test_api_server_registers_once():
    src = (REPO / "agent" / "api_server.py").read_text(encoding="utf-8")
    assert len(re.findall(r"^register_claude_chat_routes\(app\)", src, re.M)) == 1
    assert "from src.api.claude_chat_routes import register_claude_chat_routes" in src
