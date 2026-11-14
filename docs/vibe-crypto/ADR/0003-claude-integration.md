# ADR 0003: Claude integration, three ways

Status: accepted
Date: 2026-11-13

## Context

Users want Claude to drive the app: ask questions, run backtests, start and
inspect paper runs, read portfolio and market data. Three surfaces were
requested:

1. An in-app chat panel powered by the Claude Agent SDK (Python
   `claude-agent-sdk`, installed: 0.2.172, bundles the Claude Code CLI).
2. The existing MCP server (`agent/mcp_server.py`, FastMCP, ~150 tools) usable
   from the Claude Code CLI with a one-command setup.
3. An embedded terminal in the Electron app running the user's own `claude`
   CLI with the MCP server pre-wired.

The app already has its own multi-provider research agent (Agent page, ReAct
loop, `anthropic` and `claude_cli` providers). It works and stays.

## Decision

**One tool surface: the MCP server.** All three surfaces reach the app through
`agent/mcp_server.py` over stdio. No second set of tool wrappers.

1. **Chat panel (backend `agent/src/claude_chat/`, routes
   `/api/claude/status` and `POST /api/claude/chat`).** Each user message calls
   `claude_agent_sdk.query()` with:
   - `mcp_servers={"vibe-crypto": {"type": "stdio", "command": sys.executable,
     "args": [<path of mcp_server.py>]}}`
   - `tools=[]` (no built-in Bash/Read/Write/Edit), `allowed_tools=["mcp__vibe-crypto"]`,
     `permission_mode="dontAsk"` (anything not allowed is denied, never prompts),
     `setting_sources=[]` (ignore the user's CLAUDE.md and settings),
   - `resume=<session_id>` for multi-turn, `include_partial_messages=True` for
     token streaming, `cwd=<runtime_root>/claude-chat`.
   Auth is whatever the SDK finds: `ANTHROPIC_API_KEY`, or the user's logged-in
   Claude Code. The response streams to the browser as Server-Sent Events over
   a POST (`fetch` reader, not `EventSource`).
   The frontend `ChatPanel` lives in a right-side dock available on every page.
2. **Claude Code CLI.** Document `claude mcp add vibe-crypto -- vibe-crypto-mcp`
   as the one command, add `vibe-crypto mcp install` (runs that command with
   absolute paths) and `vibe-crypto mcp config` (prints `--mcp-config` JSON),
   and ship a project `.mcp.json`. New paper-run tools are added to the MCP
   server so Claude can start and inspect forward paper runs.
3. **Embedded terminal.** Electron main spawns `claude --mcp-config <file>` in
   a `node-pty` PTY; the renderer shows it with `@xterm/xterm` in the same dock
   (Terminal tab, desktop only). The MCP config file points at the backend's
   `vibe-crypto-mcp` (or bundled Python) so it uses the same runtime as the app.

Safety: order placement is never MCP-exposed (`trading_place_order` /
`trading_cancel_order` are excluded upstream), shell tools stay off unless
`VIBE_TRADING_ENABLE_SHELL_TOOLS=1`. So chat and terminal can research, backtest
and paper trade, and can read but not place live orders.

## Consequences

- Adding a tool to `mcp_server.py` makes it available in all three surfaces.
- The chat spawns one MCP subprocess per message (cold start ~2-5 s). Fine for
  a chat; revisit with `ClaudeSDKClient` only if it hurts.
- Chat needs Claude credentials; without them `/api/claude/status` reports
  `available: false` and the panel explains how to fix it.
- Tests mock the SDK (`src.claude_chat.service._query`); no API key in CI.

## Alternatives rejected

- **In-process SDK MCP server (`create_sdk_mcp_server`) with hand-written
  tools.** Duplicates the MCP server. Rejected.
- **Replace the existing Agent page with the SDK.** Rewrites a working
  subsystem and drops non-Anthropic providers. Rejected.
- **Plain Anthropic API tool-runner loop.** We would re-implement session
  persistence, MCP client and tool permissions that the Agent SDK gives us.
- **Long-lived `ClaudeSDKClient` per session.** Process lifecycle management
  for no proven need. Rejected for now.
- **Expose live order placement to Claude.** Out of scope; live connectors stay
  as-is with their existing mandate and confirmation flows.
