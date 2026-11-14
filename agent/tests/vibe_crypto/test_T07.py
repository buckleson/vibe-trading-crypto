"""T07 acceptance tests: MCP server for Claude Code (paper-run tools, setup helpers, CLI, docs).

Offline and deterministic: the backtest engine (``src.paper_runs.service._run_backtest``)
is replaced by a fake that writes synthetic artifacts, ``which``/``runner`` are injected
into the setup helpers, and no exchange, Anthropic API or real ``~/.claude.json`` is touched.
The optional real Claude Code CLI check runs only with ``VIBE_T07_REAL_CLAUDE=1`` and a temp HOME.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[3]
AGENT_DIR = REPO / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

import mcp_server  # noqa: E402
import src.paper_runs.service as svc_mod  # noqa: E402
from cli.commands import mcp_setup as ms  # noqa: E402
from src.paper_runs import PaperRuns  # noqa: E402

NAMES = ("paper_run_list", "paper_run_start", "paper_run_status", "paper_run_stop")
BRIEF_KEYS = {"id", "label", "codes", "interval", "status", "state",
              "started_at", "last_refreshed_at", "summary"}


# --------------------------------------------------------------------------- fixtures


class FakeBacktest:
    """Fake run_backtest writing ``bars`` equity rows and ``n_trades`` trades."""

    def __init__(self, *, bars=120, n_trades=30, response=None, raises=None,
                 write_equity=True, positions=None):
        self.bars, self.n_trades = bars, n_trades
        self.response = response if response is not None else json.dumps({"status": "ok"})
        self.raises = raises
        self.write_equity = write_equity
        self.positions = positions if positions is not None else {"BTC-USDT": 0.5}
        self.calls: list[str] = []

    def __call__(self, run_dir: str) -> str:
        self.calls.append(run_dir)
        if self.raises is not None:
            raise self.raises
        if json.loads(self.response).get("status") != "ok":
            return self.response
        a = Path(run_dir) / "artifacts"
        a.mkdir()
        idx = pd.date_range("2025-06-11", periods=max(self.bars, 1), freq="D", name="timestamp")
        if self.write_equity:
            pd.DataFrame({"ret": 0.0, "equity": [10000.0 + i for i in range(self.bars)],
                          "drawdown": [0.0] * self.bars, "benchmark_equity": 1.0, "active_ret": 0.0},
                         index=idx[: self.bars]).to_csv(a / "equity.csv")
        if self.n_trades:
            ts = pd.date_range("2025-06-11", periods=self.n_trades, freq="h")
            pd.DataFrame({"timestamp": ts, "code": "BTC-USDT", "side": "buy",
                          "price": [100.0 + i for i in range(self.n_trades)], "qty": 1.0,
                          "reason": "sig", "pnl": 1.0, "holding_days": 1, "holding_bars": 1,
                          "return_pct": 0.01, "event": "exit"}).to_csv(a / "trades.csv", index=False)
        pd.DataFrame({k: [v] * max(self.bars, 1) for k, v in self.positions.items()} or
                     {"BTC-USDT": [0.0] * max(self.bars, 1)},
                     index=idx).to_csv(a / "positions.csv")
        pd.DataFrame([{"sharpe": 1.5, "total_return": 0.1}]).to_csv(a / "metrics.csv", index=False)
        return json.dumps({"status": "ok"})


def make_source(home: Path, run_id="src1", *, config=None, signal=True, raw=None, drop=()):
    d = home / "runs" / run_id
    (d / "code").mkdir(parents=True, exist_ok=True)
    cfg = {"codes": ["BTC-USDT"], "source": "okx", "interval": "1D", "start_date": "2025-01-01",
           "end_date": "2025-06-01", "initial_cash": 10000, "warmup_bars": 50}
    cfg.update(config or {})
    for k in drop:
        cfg.pop(k, None)
    (d / "config.json").write_text(raw if raw is not None else json.dumps(cfg))
    if signal:
        (d / "code" / "signal_engine.py").write_text("class SignalEngine:\n    pass\n")
    return run_id


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path))
    make_source(tmp_path)
    return tmp_path


@pytest.fixture
def fake(monkeypatch):
    f = FakeBacktest()
    monkeypatch.setattr(svc_mod, "_run_backtest", f)
    return f


def _client_call(name, args=None):
    import fastmcp

    async def go():
        async with fastmcp.Client(mcp_server.mcp) as c:
            r = await c.call_tool(name, args or {}, raise_on_error=False)
            return r.content[0].text

    return json.loads(asyncio.run(go()))


def _tools():
    import fastmcp

    async def go():
        async with fastmcp.Client(mcp_server.mcp) as c:
            return {t.name: t for t in await c.list_tools()}

    return asyncio.run(go())


def _start(**kw):
    kw.setdefault("run_id", "src1")
    return json.loads(mcp_server.paper_run_start(**kw))


# --------------------------------------------------------------------------- tool registration


def test_four_tools_registered_via_client():
    tools = _tools()
    for n in NAMES:
        assert n in tools


@pytest.mark.parametrize("name,phrase", [
    ("paper_run_list", "without placing real orders"),
    ("paper_run_start", "list_backtest_runs"),
    ("paper_run_start", "first bar after now"),
    ("paper_run_status", "equity"),
    ("paper_run_stop", "Stop"),
])
def test_docstrings_are_present_and_specific(name, phrase):
    desc = _tools()[name].description or ""
    assert phrase in desc
    assert "—" not in desc


def test_input_schemas():
    tools = _tools()
    assert set(tools["paper_run_list"].inputSchema.get("properties", {})) == set()
    start = tools["paper_run_start"].inputSchema
    assert set(start["properties"]) == {"run_id", "label", "initial_cash"}
    assert start.get("required") == ["run_id"]
    status = tools["paper_run_status"].inputSchema
    assert set(status["properties"]) == {"paper_run_id", "refresh", "max_trades"}
    assert status["properties"]["refresh"].get("default") is True
    assert status["properties"]["max_trades"].get("default") == 20
    assert status.get("required") == ["paper_run_id"]
    stop = tools["paper_run_stop"].inputSchema
    assert stop.get("required") == ["paper_run_id"]


def test_tools_placed_after_paper_trade_reconcile():
    text = (AGENT_DIR / "mcp_server.py").read_text()
    anchor = text.index("def paper_trade_reconcile")
    for n in NAMES:
        assert text.index(f"def {n}(") > anchor


def test_paper_runs_import_is_lazy():
    text = (AGENT_DIR / "mcp_server.py").read_text()
    top = text[: text.index("@mcp.tool")]
    assert "src.paper_runs" not in top


def test_tool_policy_does_not_deny_paper_run_tools():
    policy = AGENT_DIR / "src" / "providers" / "tool_policy.py"
    if policy.exists():
        t = policy.read_text()
        assert "paper_run" not in t or "deny" not in t.split("paper_run")[0][-200:].lower()


# --------------------------------------------------------------------------- paper_run_list


def test_list_empty_state(home, fake):
    out = _client_call("paper_run_list")
    assert out == {"status": "ok", "runs": []}


def test_list_brief_keys_only_and_newest_first(home, fake, monkeypatch):
    from datetime import datetime, timezone
    times = iter([datetime(2025, 6, 1, tzinfo=timezone.utc), datetime(2025, 6, 2, tzinfo=timezone.utc)])
    orig_init = PaperRuns.__init__

    def init(self, *a, **kw):
        orig_init(self, *a, **kw)
        self._clock = lambda: next(times)

    monkeypatch.setattr(PaperRuns, "__init__", init)
    a = _start(label="older")["run"]["id"]
    b = _start(label="newer")["run"]["id"]
    runs = _client_call("paper_run_list")["runs"]
    assert [r["id"] for r in runs] == [b, a]
    for r in runs:
        assert set(r) == BRIEF_KEYS
        assert "source_run_id" not in r and "initial_cash" not in r


def test_list_skips_corrupt_entries(home, fake):
    pid = _start()["run"]["id"]
    bad = home / "paper-runs" / "abcdefabcdef"
    bad.mkdir(parents=True)
    (bad / "paper_run.json").write_text("{not json")
    (home / "paper-runs" / "not-an-id").mkdir()
    assert [r["id"] for r in _client_call("paper_run_list")["runs"]] == [pid]


def test_list_internal_error(home, monkeypatch):
    def boom(self):
        raise RuntimeError("disk gone")
    monkeypatch.setattr(PaperRuns, "list", boom)
    out = json.loads(mcp_server.paper_run_list())
    assert out["status"] == "error" and out["error_type"] == "internal"
    assert "disk gone" in out["error"]


# --------------------------------------------------------------------------- paper_run_start


def test_start_defaults(home, fake):
    out = _client_call("paper_run_start", {"run_id": "src1"})
    assert out["status"] == "ok"
    run = out["run"]
    assert len(run["id"]) == 12
    assert run["label"] == "BTC-USDT paper"
    assert run["initial_cash"] == 10000
    assert run["status"] == "active" and run["state"] == "waiting"
    assert run["source_run_id"] == "src1"
    assert fake.calls == []  # start does not run a backtest


def test_start_label_and_cash(home, fake):
    run = _client_call("paper_run_start", {"run_id": "src1", "label": "My run", "initial_cash": 2500.5})["run"]
    assert run["label"] == "My run" and run["initial_cash"] == 2500.5


def test_start_empty_label_uses_default(home, fake):
    assert _start(label="")["run"]["label"] == "BTC-USDT paper"


def test_start_label_truncated_to_80(home, fake):
    assert len(_start(label="x" * 200)["run"]["label"]) == 80


def test_start_uses_source_initial_cash_when_none(home, fake):
    make_source(home, "src2", config={"initial_cash": 777})
    assert _start(run_id="src2", initial_cash=None)["run"]["initial_cash"] == 777


@pytest.mark.parametrize("run_id", ["../x", "..", ".", "", "a/b", "a b", "x" * 201, "missing"])
def test_start_invalid_run_id(home, fake, run_id):
    out = _start(run_id=run_id)
    assert out["status"] == "error" and out["error_type"] == "invalid"
    assert out["error"]


@pytest.mark.parametrize("cash", [0, -1, -0.01, float("inf")])
def test_start_invalid_cash(home, fake, cash):
    out = _start(initial_cash=cash)
    assert out["error_type"] == "invalid"


@pytest.mark.parametrize("kw", [
    {"signal": False},
    {"raw": "{broken"},
    {"config": {"codes": []}},
    {"config": {"codes": "BTC-USDT"}},
    {"drop": ("codes",)},
    {"config": {"interval": "2D"}},
])
def test_start_invalid_source(home, fake, kw):
    make_source(home, "bad", **kw)
    out = _client_call("paper_run_start", {"run_id": "bad"})
    assert out["status"] == "error" and out["error_type"] == "invalid"


def test_start_internal_error(home, monkeypatch):
    def boom(self, **kw):
        raise OSError("read only fs")
    monkeypatch.setattr(PaperRuns, "create", boom)
    out = _start()
    assert out["error_type"] == "internal" and "read only fs" in out["error"]


# --------------------------------------------------------------------------- paper_run_status


def test_status_refresh_default(home, fake):
    pid = _start()["run"]["id"]
    out = _client_call("paper_run_status", {"paper_run_id": pid})
    assert out["status"] == "ok"
    assert set(out) == {"status", "run", "summary", "positions", "trades", "equity"}
    assert len(fake.calls) == 1
    assert out["run"]["state"] == "ok"
    assert out["summary"] == out["run"]["summary"]
    assert out["summary"]["trade_count"] == 30
    assert len(out["trades"]) == 20  # default max_trades
    assert out["positions"] == [{"symbol": "BTC-USDT", "weight": 0.5}]


def test_status_without_refresh_does_not_backtest(home, fake):
    pid = _start()["run"]["id"]
    out = _client_call("paper_run_status", {"paper_run_id": pid, "refresh": False})
    assert fake.calls == []
    assert out["run"]["state"] == "waiting"
    assert out["summary"] is None
    assert out["trades"] == [] and out["equity"] == [] and out["positions"] == []


def test_status_trades_newest_first(home, fake):
    pid = _start()["run"]["id"]
    trades = _client_call("paper_run_status", {"paper_run_id": pid, "max_trades": 3})["trades"]
    assert [t["price"] for t in trades] == [129.0, 128.0, 127.0]


@pytest.mark.parametrize("max_trades,expected", [
    (0, 0), (1, 1), (-1, 0), (-1000, 0), (199, 199), (200, 200), (201, 200), (10_000, 200),
])
def test_status_max_trades_clamped(home, monkeypatch, max_trades, expected):
    monkeypatch.setattr(svc_mod, "_run_backtest", FakeBacktest(n_trades=300))
    pid = _start()["run"]["id"]
    out = _client_call("paper_run_status", {"paper_run_id": pid, "max_trades": max_trades})
    assert len(out["trades"]) == expected


def test_status_max_trades_more_than_available(home, fake):
    pid = _start()["run"]["id"]
    assert len(_client_call("paper_run_status", {"paper_run_id": pid, "max_trades": 150})["trades"]) == 30


def test_status_max_trades_non_int_falls_back_to_default(home, fake):
    pid = _start()["run"]["id"]
    out = json.loads(mcp_server.paper_run_status(pid, max_trades="abc"))
    assert len(out["trades"]) == 20


@pytest.mark.parametrize("bars,expected", [(1, 1), (2, 2), (49, 49), (50, 50), (51, 50), (120, 50), (1000, 50)])
def test_status_equity_downsampled(home, monkeypatch, bars, expected):
    monkeypatch.setattr(svc_mod, "_run_backtest", FakeBacktest(bars=bars, n_trades=0))
    pid = _start()["run"]["id"]
    eq = _client_call("paper_run_status", {"paper_run_id": pid})["equity"]
    assert len(eq) == expected
    assert eq[0]["equity"] == 10000.0
    assert eq[-1]["equity"] == 10000.0 + bars - 1
    times = [p["time"] for p in eq]
    assert times == sorted(times) and len(set(times)) == len(times)


def test_status_no_trades_file(home, monkeypatch):
    monkeypatch.setattr(svc_mod, "_run_backtest", FakeBacktest(n_trades=0))
    pid = _start()["run"]["id"]
    out = _client_call("paper_run_status", {"paper_run_id": pid})
    assert out["trades"] == [] and out["summary"]["trade_count"] == 0


def test_status_flat_positions_empty(home, monkeypatch):
    monkeypatch.setattr(svc_mod, "_run_backtest", FakeBacktest(positions={"BTC-USDT": 0.0}))
    pid = _start()["run"]["id"]
    assert _client_call("paper_run_status", {"paper_run_id": pid})["positions"] == []


def test_status_backtest_error_is_reported_in_state_not_envelope(home, monkeypatch):
    monkeypatch.setattr(svc_mod, "_run_backtest",
                        FakeBacktest(response=json.dumps({"status": "error", "error": "engine blew up"})))
    pid = _start()["run"]["id"]
    out = _client_call("paper_run_status", {"paper_run_id": pid})
    assert out["status"] == "ok"
    assert out["run"]["state"] == "error" and "engine blew up" in out["run"]["last_error"]
    assert out["summary"] is None and out["equity"] == []


def test_status_backtest_raising_is_state_error(home, monkeypatch):
    monkeypatch.setattr(svc_mod, "_run_backtest", FakeBacktest(raises=RuntimeError("kaboom")))
    pid = _start()["run"]["id"]
    out = _client_call("paper_run_status", {"paper_run_id": pid})
    assert out["status"] == "ok" and out["run"]["state"] == "error"
    assert "kaboom" in out["run"]["last_error"]


def test_status_waiting_marker(home, monkeypatch):
    monkeypatch.setattr(svc_mod, "_run_backtest",
                        FakeBacktest(response=json.dumps({"status": "error", "error": "No data fetched"})))
    pid = _start()["run"]["id"]
    out = _client_call("paper_run_status", {"paper_run_id": pid})
    assert out["run"]["state"] == "waiting" and out["run"]["last_error"] is None


@pytest.mark.parametrize("pid", ["deadbeef0000", "DEADBEEF0000", "../etc", "", "abc", "deadbeef00001"])
@pytest.mark.parametrize("refresh", [True, False])
def test_status_not_found(home, fake, pid, refresh):
    out = _client_call("paper_run_status", {"paper_run_id": pid, "refresh": refresh})
    assert out["status"] == "error" and out["error_type"] == "not_found"
    assert fake.calls == []


def test_status_internal_error(home, fake, monkeypatch):
    pid = _start()["run"]["id"]

    def boom(self, paper_id):
        raise RuntimeError("weird")
    monkeypatch.setattr(PaperRuns, "detail", boom)
    out = _client_call("paper_run_status", {"paper_run_id": pid, "refresh": False})
    assert out["error_type"] == "internal"


def test_status_result_is_json_serialisable_with_nan_free_values(home, fake):
    pid = _start()["run"]["id"]
    raw = mcp_server.paper_run_status(pid)
    assert "NaN" not in raw and "Infinity" not in raw


# --------------------------------------------------------------------------- paper_run_stop


def test_stop_and_idempotent(home, fake):
    pid = _start()["run"]["id"]
    first = _client_call("paper_run_stop", {"paper_run_id": pid})
    assert first["status"] == "ok" and first["run"]["status"] == "stopped"
    stopped_at = first["run"]["stopped_at"]
    assert stopped_at
    second = _client_call("paper_run_stop", {"paper_run_id": pid})
    assert second["run"]["stopped_at"] == stopped_at
    assert fake.calls == []
    listed = _client_call("paper_run_list")["runs"]
    assert listed[0]["status"] == "stopped"


def test_stopped_run_still_readable_and_refreshable(home, fake):
    pid = _start()["run"]["id"]
    _client_call("paper_run_stop", {"paper_run_id": pid})
    out = _client_call("paper_run_status", {"paper_run_id": pid})
    assert out["status"] == "ok" and out["run"]["status"] == "stopped" and out["run"]["state"] == "ok"


@pytest.mark.parametrize("pid", ["deadbeef0000", "../x", ""])
def test_stop_not_found(home, fake, pid):
    out = _client_call("paper_run_stop", {"paper_run_id": pid})
    assert out["status"] == "error" and out["error_type"] == "not_found"


def test_stop_internal_error(home, fake, monkeypatch):
    pid = _start()["run"]["id"]

    def boom(self, paper_id):
        raise RuntimeError("lock")
    monkeypatch.setattr(PaperRuns, "stop", boom)
    assert json.loads(mcp_server.paper_run_stop(pid))["error_type"] == "internal"


def test_full_lifecycle_through_client(home, fake):
    assert _client_call("paper_run_list")["runs"] == []
    pid = _client_call("paper_run_start", {"run_id": "src1", "initial_cash": 5000})["run"]["id"]
    st = _client_call("paper_run_status", {"paper_run_id": pid})
    assert st["run"]["state"] == "ok" and len(st["equity"]) <= 50
    assert st["run"]["last_refreshed_at"]
    brief = _client_call("paper_run_list")["runs"][0]
    assert brief["state"] == "ok" and brief["summary"]["pnl"] == pytest.approx(10119 - 5000)
    assert _client_call("paper_run_stop", {"paper_run_id": pid})["run"]["status"] == "stopped"


# --------------------------------------------------------------------------- _downsample


@pytest.mark.parametrize("n", [0, 1, 2, 3, 49, 50, 51, 99, 100, 101, 777, 5000])
@pytest.mark.parametrize("limit", [2, 3, 50])
def test_downsample_invariants(n, limit):
    rows = list(range(n))
    out = mcp_server._downsample(rows, limit)
    if n <= limit:
        assert out == rows
    else:
        assert len(out) <= limit
        assert out[0] == 0 and out[-1] == n - 1
        assert out == sorted(set(out))


def test_downsample_exact_limit_when_large():
    assert len(mcp_server._downsample(list(range(1000)), 50)) == 50


# --------------------------------------------------------------------------- setup helpers


def which_map(mapping):
    calls = []

    def which(name):
        calls.append(name)
        return mapping.get(name)
    which.calls = calls
    return which


def test_server_name():
    assert ms.SERVER_NAME == "vibe-crypto"


def test_command_prefers_console_script(tmp_path):
    exe = tmp_path / "vibe-crypto-mcp"
    exe.write_text("#!/bin/sh\n")
    w = which_map({"vibe-crypto-mcp": str(exe)})
    cmd, args = ms.mcp_server_command(w)
    assert cmd == str(exe.resolve()) and args == []
    assert "vibe-crypto-mcp" in w.calls


def test_command_resolves_symlink_to_absolute(tmp_path):
    real = tmp_path / "real-mcp"
    real.write_text("")
    link = tmp_path / "vibe-crypto-mcp"
    link.symlink_to(real)
    cmd, _ = ms.mcp_server_command(which_map({"vibe-crypto-mcp": str(link)}))
    assert Path(cmd).is_absolute() and cmd == str(real.resolve())


def test_command_relative_which_result_made_absolute(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    cmd, _ = ms.mcp_server_command(which_map({"vibe-crypto-mcp": "bin/vibe-crypto-mcp"}))
    assert Path(cmd).is_absolute()


@pytest.mark.parametrize("found", [None, ""])
def test_command_fallback_python_plus_script(found):
    cmd, args = ms.mcp_server_command(which_map({"vibe-crypto-mcp": found}))
    assert cmd == sys.executable
    assert len(args) == 1
    p = Path(args[0])
    assert p.is_absolute() and p.name == "mcp_server.py" and p.is_file()


def test_command_fallback_without_find_spec(monkeypatch):
    monkeypatch.setattr(ms.importlib.util, "find_spec", lambda name: None)
    _, args = ms.mcp_server_command(which_map({}))
    assert Path(args[0]) == (AGENT_DIR / "mcp_server.py").resolve()


def test_command_fallback_spec_without_origin(monkeypatch):
    monkeypatch.setattr(ms.importlib.util, "find_spec", lambda name: SimpleNamespace(origin=None))
    _, args = ms.mcp_server_command(which_map({}))
    assert Path(args[0]).is_file()


def test_command_fallback_uses_find_spec_origin(monkeypatch, tmp_path):
    fake = tmp_path / "mcp_server.py"
    fake.write_text("")
    monkeypatch.setattr(ms.importlib.util, "find_spec", lambda name: SimpleNamespace(origin=str(fake)))
    _, args = ms.mcp_server_command(which_map({}))
    assert args == [str(fake.resolve())]


def test_config_shape_found():
    cfg = ms.mcp_config(which_map({"vibe-crypto-mcp": "/opt/bin/vibe-crypto-mcp"}))
    assert cfg == {"mcpServers": {"vibe-crypto": {"command": "/opt/bin/vibe-crypto-mcp", "args": []}}}


def test_config_shape_fallback_is_json_roundtrippable():
    cfg = ms.mcp_config(which_map({}))
    assert json.loads(json.dumps(cfg)) == cfg
    entry = cfg["mcpServers"]["vibe-crypto"]
    assert set(entry) == {"command", "args"}
    assert entry["command"] == sys.executable and isinstance(entry["args"], list)


def test_install_argv_default_scope_is_user():
    argv = ms.install_argv(which=which_map({"vibe-crypto-mcp": "/x/vibe-crypto-mcp"}))
    assert argv == ["claude", "mcp", "add", "--scope", "user", "vibe-crypto", "--", "/x/vibe-crypto-mcp"]


@pytest.mark.parametrize("scope", ["local", "user", "project"])
def test_install_argv_each_scope(scope):
    argv = ms.install_argv(scope, which_map({"vibe-crypto-mcp": "/x/vibe-crypto-mcp"}))
    assert argv[3:5] == ["--scope", scope]
    assert argv[5:7] == ["vibe-crypto", "--"]


def test_install_argv_fallback_args_follow_separator():
    argv = ms.install_argv("local", which_map({}))
    sep = argv.index("--")
    assert argv[sep + 1] == sys.executable and argv[sep + 2].endswith("mcp_server.py")
    assert len(argv) == sep + 3


@pytest.mark.parametrize("scope", ["", "USER", "global", "User ", None, "users"])
def test_install_argv_invalid_scope(scope):
    with pytest.raises(ValueError):
        ms.install_argv(scope, which_map({"vibe-crypto-mcp": "/x"}))


def test_run_install_dry_run_prints_exact_line_and_skips_runner():
    out = io.StringIO()
    w = which_map({"vibe-crypto-mcp": "/x/vibe-crypto-mcp"})
    calls = []
    rc = ms.run_install("project", True, which=w, runner=lambda a, **k: calls.append(a), out=out)
    assert rc == 0 and calls == []
    assert out.getvalue() == "claude mcp add --scope project vibe-crypto -- /x/vibe-crypto-mcp\n"
    assert "claude" not in w.calls  # dry run needs no claude CLI


def test_run_install_dry_run_quotes_paths_with_spaces(tmp_path):
    d = tmp_path / "my dir"
    d.mkdir()
    exe = d / "vibe-crypto-mcp"
    exe.write_text("")
    out = io.StringIO()
    ms.run_install("user", True, which=which_map({"vibe-crypto-mcp": str(exe)}), out=out)
    assert shlex.split(out.getvalue()) == ms.install_argv("user", which_map({"vibe-crypto-mcp": str(exe)}))


def test_run_install_invalid_scope_raises_even_on_dry_run():
    with pytest.raises(ValueError):
        ms.run_install("bogus", True, which=which_map({}), out=io.StringIO())


def test_run_install_claude_missing():
    out = io.StringIO()
    calls = []
    w = which_map({"vibe-crypto-mcp": "/x/vibe-crypto-mcp"})
    rc = ms.run_install("user", False, which=w, runner=lambda a, **k: calls.append(a), out=out)
    assert rc == 1 and calls == []
    lines = out.getvalue().splitlines()
    assert lines[0] == ("Claude Code CLI not found. Install it "
                        "(npm install -g @anthropic-ai/claude-code), then run:")
    assert lines[1] == "claude mcp add --scope user vibe-crypto -- /x/vibe-crypto-mcp"
    assert "claude" in w.calls


def test_run_install_success():
    out = io.StringIO()
    seen = []

    def runner(argv, **kw):
        seen.append((argv, kw))
        return SimpleNamespace(returncode=0)
    w = which_map({"vibe-crypto-mcp": "/x/vibe-crypto-mcp", "claude": "/x/claude"})
    rc = ms.run_install("local", False, which=w, runner=runner, out=out)
    assert rc == 0
    assert len(seen) == 1
    argv, kw = seen[0]
    assert isinstance(argv, list) and argv == ms.install_argv("local", w)
    assert not kw.get("shell")
    assert out.getvalue().strip() == "Added vibe-crypto to Claude Code. Start claude and type /mcp to check it."


@pytest.mark.parametrize("code", [1, 2, 127, 255])
def test_run_install_failure_propagates_and_hints(code):
    out = io.StringIO()
    w = which_map({"vibe-crypto-mcp": "/x/vibe-crypto-mcp", "claude": "/x/claude"})
    rc = ms.run_install("user", False, which=w, runner=lambda a, **k: SimpleNamespace(returncode=code), out=out)
    assert rc == code
    assert "If it already exists, run: claude mcp remove vibe-crypto" in out.getvalue()
    assert "Added vibe-crypto" not in out.getvalue()


def test_run_install_default_out_is_stdout(capsys):
    rc = ms.run_install("user", True, which=which_map({"vibe-crypto-mcp": "/x/vibe-crypto-mcp"}))
    assert rc == 0
    assert capsys.readouterr().out.startswith("claude mcp add --scope user vibe-crypto -- ")


def test_print_config(capsys):
    assert ms.print_config() == 0
    cfg = json.loads(capsys.readouterr().out)
    assert list(cfg["mcpServers"]) == ["vibe-crypto"]


# --------------------------------------------------------------------------- CLI wiring


def _legacy():
    from cli import _legacy
    return _legacy


def test_cli_mcp_config(capsys):
    assert _legacy().main(["mcp", "config"]) == 0
    out = capsys.readouterr().out
    cfg = json.loads(out)
    assert set(cfg["mcpServers"]["vibe-crypto"]) == {"command", "args"}


@pytest.mark.parametrize("argv,scope,dry", [
    (["mcp", "install"], "user", False),
    (["mcp", "install", "--dry-run"], "user", True),
    (["mcp", "install", "--scope", "local"], "local", False),
    (["mcp", "install", "--scope", "project", "--dry-run"], "project", True),
])
def test_cli_mcp_install_dispatch(monkeypatch, argv, scope, dry):
    seen = []
    monkeypatch.setattr(ms, "run_install", lambda s, d: (seen.append((s, d)), 7)[1])
    assert _legacy().main(argv) == 7
    assert seen == [(scope, dry)]


def test_cli_mcp_install_dry_run_real(capsys):
    assert _legacy().main(["mcp", "install", "--scope", "project", "--dry-run"]) == 0
    line = capsys.readouterr().out.strip()
    argv = shlex.split(line)
    assert argv[:7] == ["claude", "mcp", "add", "--scope", "project", "vibe-crypto", "--"]
    assert len(argv) >= 8


@pytest.mark.parametrize("argv", [["mcp"], ["mcp", "install", "--scope", "global"], ["mcp", "bogus"]])
def test_cli_mcp_usage_errors(argv, capsys):
    assert _legacy().main(argv) == 2  # main() turns argparse SystemExit into a return code
    assert "usage" in capsys.readouterr().err.lower()


def test_cli_mcp_help_lists_subcommands(capsys):
    assert _legacy().main(["mcp", "--help"]) == 0
    out = capsys.readouterr().out
    assert "config" in out and "install" in out


def test_cli_mcp_install_help_lists_options(capsys):
    assert _legacy().main(["mcp", "install", "--help"]) == 0
    out = capsys.readouterr().out
    assert "--scope" in out and "--dry-run" in out
    for s in ("local", "user", "project"):
        assert s in out


@pytest.mark.skipif(shutil.which("vibe-crypto") is None, reason="console script not installed")
def test_console_script_mcp_config_subprocess(tmp_path):
    env = dict(os.environ, HOME=str(tmp_path), VIBE_TRADING_HOME=str(tmp_path / "vt"))
    r = subprocess.run([shutil.which("vibe-crypto"), "mcp", "config"], capture_output=True,
                       text=True, timeout=120, env=env)
    assert r.returncode == 0, r.stderr
    assert "vibe-crypto" in json.loads(r.stdout)["mcpServers"]


# --------------------------------------------------------------------------- project config and packaging


def test_repo_mcp_json_exact():
    cfg = json.loads((REPO / ".mcp.json").read_text())
    assert cfg == {"mcpServers": {"vibe-crypto": {"command": "vibe-crypto-mcp", "args": []}}}


def test_pyproject_declares_mcp_console_script():
    text = (REPO / "pyproject.toml").read_text()
    assert 'vibe-crypto-mcp = "mcp_server:main"' in text
    assert 'vibe-crypto = "cli:main"' in text


# --------------------------------------------------------------------------- docs


DOC = REPO / "docs" / "vibe-crypto" / "CLAUDE_CODE.md"


@pytest.mark.parametrize("section", [
    "What you get", "Prerequisites", "Set up with one command", "Project config", "Check it works",
    "Tools", "HTTP transport", "Safety", "Inside the app", "Troubleshooting",
])
def test_doc_sections(section):
    assert f"## {section}" in DOC.read_text()


@pytest.mark.parametrize("snippet", [
    "claude mcp add vibe-crypto -- vibe-crypto-mcp",
    "vibe-crypto mcp install",
    "vibe-crypto mcp config",
    "--mcp-config",
    ".mcp.json",
    "claude mcp list",
    "/mcp",
    "vibe-crypto-mcp --transport http --port 8900",
    "claude mcp add --transport http vibe-crypto http://127.0.0.1:8900/mcp",
    "--enable-shell-tools",
    "VIBE_TRADING_ENABLE_SHELL_TOOLS=1",
    "pip install -e .",
    "paper_run_start",
    "paper_run_status",
    "paper_run_list",
    "paper_run_stop",
    "~/.vibe-trading/.env",
])
def test_doc_mentions(snippet):
    assert snippet in DOC.read_text()


def test_doc_has_no_em_dashes():
    assert "—" not in DOC.read_text()


def test_handoff_exists():
    assert (REPO / "docs" / "vibe-crypto" / "handoff" / "T07.md").is_file()


# --------------------------------------------------------------------------- optional real Claude Code CLI check


CLAUDE = "/opt/node22/bin/claude"


@pytest.mark.skipif(os.environ.get("VIBE_T07_REAL_CLAUDE") != "1" or not Path(CLAUDE).exists(),
                    reason="set VIBE_T07_REAL_CLAUDE=1 to run the real claude mcp add/list check")
def test_real_claude_mcp_add_and_list(tmp_path):
    env = dict(os.environ, HOME=str(tmp_path))
    env.pop("ANTHROPIC_API_KEY", None)
    argv = ms.install_argv("user")
    argv[0] = CLAUDE
    r = subprocess.run(argv, capture_output=True, text=True, env=env, cwd=str(tmp_path), timeout=120)
    assert r.returncode == 0, r.stderr + r.stdout
    cfg = json.loads((tmp_path / ".claude.json").read_text())
    assert "vibe-crypto" in cfg.get("mcpServers", {})
    r = subprocess.run([CLAUDE, "mcp", "list"], capture_output=True, text=True, env=env,
                       cwd=str(tmp_path), timeout=180)
    assert "vibe-crypto" in r.stdout
    assert "Connected" in r.stdout, r.stdout
