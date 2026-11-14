"""Tests for the Claude Code MCP setup helpers and CLI wiring."""

from __future__ import annotations

import io
import json
import shlex
import sys
from types import SimpleNamespace

import pytest

from cli.commands import mcp_setup as ms


def _which_found(name):
    return {"vibe-crypto-mcp": "/opt/bin/vibe-crypto-mcp", "claude": "/opt/bin/claude"}.get(name)


def _which_none(name):
    return None


def test_command_prefers_console_script():
    assert ms.mcp_server_command(_which_found) == ("/opt/bin/vibe-crypto-mcp", [])


def test_command_falls_back_to_python_and_script():
    cmd, args = ms.mcp_server_command(_which_none)
    assert cmd == sys.executable
    assert len(args) == 1 and args[0].endswith("mcp_server.py")


def test_config_shape():
    cfg = ms.mcp_config(_which_found)
    assert cfg == {"mcpServers": {"vibe-crypto": {"command": "/opt/bin/vibe-crypto-mcp", "args": []}}}


@pytest.mark.parametrize("scope", ["local", "user", "project"])
def test_install_argv_scopes(scope):
    assert ms.install_argv(scope, _which_found) == [
        "claude", "mcp", "add", "--scope", scope, "vibe-crypto", "--", "/opt/bin/vibe-crypto-mcp",
    ]


def test_install_argv_invalid_scope():
    with pytest.raises(ValueError):
        ms.install_argv("global", _which_found)


def test_dry_run_prints_and_does_not_run():
    out = io.StringIO()
    calls = []
    rc = ms.run_install("user", True, which=_which_found, runner=lambda a: calls.append(a), out=out)
    assert rc == 0 and not calls
    assert shlex.split(out.getvalue())[:3] == ["claude", "mcp", "add"]


def test_claude_missing_returns_1():
    out = io.StringIO()
    calls = []
    rc = ms.run_install("user", False, which=lambda n: "/x/vibe-crypto-mcp" if n == "vibe-crypto-mcp" else None,
                        runner=lambda a: calls.append(a), out=out)
    assert rc == 1 and not calls
    assert "Claude Code CLI not found" in out.getvalue()
    assert "claude mcp add" in out.getvalue()


def test_runner_called_and_exit_code_propagated():
    calls = []
    out = io.StringIO()
    rc = ms.run_install("project", False, which=_which_found,
                        runner=lambda a: (calls.append(a), SimpleNamespace(returncode=0))[1], out=out)
    assert rc == 0 and calls[0][:5] == ["claude", "mcp", "add", "--scope", "project"]
    assert "Added vibe-crypto to Claude Code" in out.getvalue()

    out = io.StringIO()
    rc = ms.run_install("user", False, which=_which_found,
                        runner=lambda a: SimpleNamespace(returncode=3), out=out)
    assert rc == 3
    assert "claude mcp remove vibe-crypto" in out.getvalue()


def test_cli_mcp_config_prints_json(capsys):
    from cli import _legacy

    assert _legacy.main(["mcp", "config"]) == 0
    cfg = json.loads(capsys.readouterr().out)
    assert "vibe-crypto" in cfg["mcpServers"]


def test_cli_mcp_install_dry_run(capsys):
    from cli import _legacy

    assert _legacy.main(["mcp", "install", "--scope", "local", "--dry-run"]) == 0
    assert capsys.readouterr().out.startswith("claude mcp add --scope local vibe-crypto --")
