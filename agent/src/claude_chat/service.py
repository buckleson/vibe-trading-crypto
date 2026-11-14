"""Claude Agent SDK chat service (ADR 0003).

The only tools Claude gets are the app's own MCP server (agent/mcp_server.py).
"""

from __future__ import annotations

import importlib.metadata
import importlib.util
import sys
from pathlib import Path
from typing import Any, AsyncIterator

from src.config.accessor import get_env_value
from src.config.paths import get_runtime_root

SERVER_NAME = "vibe-crypto"
TOOL_PREFIX = f"mcp__{SERVER_NAME}__"

SYSTEM_PROMPT = (
    "You are Claude inside Vibe Crypto, a local app for research, backtesting and paper "
    "trading of crypto, stocks and other markets. Use the vibe-crypto tools to work with "
    "real data: list and read backtest runs, run backtests, start and check paper runs, "
    "and read portfolio and market data. You cannot place live orders. Be concise, show "
    "numbers with units and dates, and never invent data you did not get from a tool."
)

_NOT_AVAILABLE = "Claude Code is not available. Reinstall the app dependencies (pip install -e .) or install Claude Code."


def mcp_server_config() -> dict:
    """Stdio config for agent/mcp_server.py (located without importing it)."""
    path: Path | None = None
    try:
        spec = importlib.util.find_spec("mcp_server")
        if spec and spec.origin:
            path = Path(spec.origin)
    except (ImportError, ValueError):
        path = None
    if path is None:
        path = Path(__file__).resolve().parents[2] / "mcp_server.py"
    return {
        "type": "stdio",
        "command": sys.executable,
        "args": [str(path)],
        "env": {"PYTHONUNBUFFERED": "1"},
    }


def build_options(session_id: str | None, model: str | None):
    from claude_agent_sdk import ClaudeAgentOptions

    cwd = get_runtime_root() / "claude-chat"
    cwd.mkdir(parents=True, exist_ok=True)
    return ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        mcp_servers={SERVER_NAME: mcp_server_config()},
        tools=[],
        allowed_tools=[f"mcp__{SERVER_NAME}"],
        permission_mode="dontAsk",
        setting_sources=[],
        include_partial_messages=True,
        resume=session_id or None,
        max_turns=30,
        model=model or get_env_value("VIBE_CRYPTO_CLAUDE_MODEL") or None,
        cwd=str(cwd),
    )


def claude_status() -> dict:
    """Cheap readiness probe. Never spawns a process."""
    available = importlib.util.find_spec("claude_agent_sdk") is not None
    version: str | None = None
    error: str | None = None
    if available:
        try:
            version = importlib.metadata.version("claude-agent-sdk")
        except importlib.metadata.PackageNotFoundError:
            version = None
    else:
        error = _NOT_AVAILABLE
    if get_env_value("ANTHROPIC_API_KEY") or get_env_value("ANTHROPIC_AUTH_TOKEN"):
        auth = "api_key"
    elif (Path.home() / ".claude").exists():
        auth = "claude_login"
    else:
        auth = "unknown"
    return {
        "available": available,
        "sdk_version": version,
        "auth": auth,
        "model": get_env_value("VIBE_CRYPTO_CLAUDE_MODEL") or None,
        "error": error,
    }


async def _query(prompt: str, options: Any) -> AsyncIterator[Any]:
    """Single monkeypatch point for tests."""
    from claude_agent_sdk import query

    async for message in query(prompt=prompt, options=options):
        yield message


def _result_text(content: Any) -> str:
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = "".join(
            str(item.get("text", "")) for item in content if isinstance(item, dict)
        )
    else:
        text = ""
    return text[:2000]


async def stream_chat(message: str, session_id: str | None, model: str | None) -> AsyncIterator[dict]:
    """Yield UI events for one chat turn. Never raises."""
    try:
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
    except ImportError:
        yield {"type": "error", "message": _NOT_AVAILABLE}
        return

    streamed = False
    try:
        async for msg in _query(message, build_options(session_id, model)):
            if isinstance(msg, SystemMessage):
                if msg.subtype == "init" and (msg.data or {}).get("session_id"):
                    yield {"type": "session", "session_id": msg.data["session_id"]}
            elif isinstance(msg, StreamEvent):
                ev = msg.event or {}
                delta = ev.get("delta") or {}
                if (
                    msg.parent_tool_use_id is None
                    and ev.get("type") == "content_block_delta"
                    and delta.get("type") == "text_delta"
                ):
                    streamed = True
                    yield {"type": "text", "delta": delta.get("text", "")}
            elif isinstance(msg, AssistantMessage):
                if msg.parent_tool_use_id is not None:
                    continue
                for block in msg.content:
                    if isinstance(block, ToolUseBlock):
                        name = block.name
                        if name.startswith(TOOL_PREFIX):
                            name = name[len(TOOL_PREFIX):]
                        yield {"type": "tool_use", "id": block.id, "name": name, "input": block.input}
                    elif isinstance(block, TextBlock) and not streamed:
                        yield {"type": "text", "delta": block.text}
                streamed = False
            elif isinstance(msg, UserMessage):
                if not isinstance(msg.content, list):
                    continue
                for block in msg.content:
                    if isinstance(block, ToolResultBlock):
                        yield {
                            "type": "tool_result",
                            "tool_use_id": block.tool_use_id,
                            "is_error": bool(block.is_error),
                            "preview": _result_text(block.content),
                        }
            elif isinstance(msg, ResultMessage):
                if msg.is_error and msg.result:
                    yield {"type": "error", "message": str(msg.result)[:500]}
                yield {
                    "type": "done",
                    "session_id": msg.session_id,
                    "is_error": bool(msg.is_error),
                    "cost_usd": msg.total_cost_usd,
                    "duration_ms": msg.duration_ms,
                }
    except CLINotFoundError:
        yield {"type": "error", "message": _NOT_AVAILABLE}
    except Exception as exc:  # noqa: BLE001 - generator must never raise
        yield {"type": "error", "message": str(exc)[:500]}
