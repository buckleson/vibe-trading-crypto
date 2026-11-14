"""One-command setup of the Vibe Crypto MCP server for Claude Code."""

from __future__ import annotations

import importlib.util
import json
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

SERVER_NAME = "vibe-crypto"
SCOPES = ("local", "user", "project")


def _mcp_server_path() -> str:
    spec = importlib.util.find_spec("mcp_server")
    if spec is not None and spec.origin:
        return str(Path(spec.origin).resolve())
    return str(Path(__file__).resolve().parents[2] / "mcp_server.py")


def mcp_server_command(which=shutil.which) -> tuple[str, list[str]]:
    """Return the command and args that launch the MCP server over stdio."""
    found = which("vibe-crypto-mcp")
    if found:
        return str(Path(found).resolve()), []
    return sys.executable, [_mcp_server_path()]


def mcp_config(which=shutil.which) -> dict:
    """Return a Claude Code ``mcpServers`` config with the server registered."""
    cmd, args = mcp_server_command(which)
    return {"mcpServers": {SERVER_NAME: {"command": cmd, "args": args}}}


def install_argv(scope: str = "user", which=shutil.which) -> list[str]:
    """Return the ``claude mcp add`` argv that registers the server."""
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
    cmd, args = mcp_server_command(which)
    return ["claude", "mcp", "add", "--scope", scope, SERVER_NAME, "--", cmd, *args]


def run_install(scope, dry_run, *, which=shutil.which, runner=subprocess.run, out=None) -> int:
    """Register the server with Claude Code. Returns a process exit code."""
    out = out or sys.stdout
    argv = install_argv(scope, which)
    line = shlex.join(argv)
    if dry_run:
        print(line, file=out)
        return 0
    if which("claude") is None:
        print("Claude Code CLI not found. Install it (npm install -g @anthropic-ai/claude-code), then run:", file=out)
        print(line, file=out)
        return 1
    code = runner(argv).returncode
    if code == 0:
        print(f"Added {SERVER_NAME} to Claude Code. Start claude and type /mcp to check it.", file=out)
    else:
        print(f"If it already exists, run: claude mcp remove {SERVER_NAME}", file=out)
    return code


def print_config(out=None) -> int:
    out = out or sys.stdout
    print(json.dumps(mcp_config(), indent=2), file=out)
    return 0
