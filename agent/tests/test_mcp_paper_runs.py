"""Paper-run MCP tools through an in-memory FastMCP client with mocked backtests."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

AGENT_DIR = Path(__file__).resolve().parent.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

NAMES = {"paper_run_list", "paper_run_start", "paper_run_status", "paper_run_stop"}


def _fake_backtest(run_dir: str) -> str:
    a = Path(run_dir) / "artifacts"
    a.mkdir()
    idx = pd.date_range("2025-06-11", periods=120, freq="D", name="timestamp")
    eq = pd.DataFrame({"ret": 0.0, "equity": [10000 + i for i in range(120)], "drawdown": 0.0,
                       "benchmark_equity": 1.0, "active_ret": 0.0}, index=idx)
    eq.to_csv(a / "equity.csv")
    pd.DataFrame({"timestamp": idx[:30], "code": "BTC-USDT", "side": "buy", "price": 100.0,
                  "qty": 1.0, "reason": "sig", "pnl": 1.0, "holding_days": 1, "holding_bars": 1,
                  "return_pct": 0.01, "event": "exit"}).to_csv(a / "trades.csv", index=False)
    pd.DataFrame({"BTC-USDT": [0.5] * 120}, index=idx).to_csv(a / "positions.csv")
    pd.DataFrame([{"sharpe": 1.5, "total_return": 0.1}]).to_csv(a / "metrics.csv", index=False)
    return json.dumps({"status": "ok"})


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path))
    src = tmp_path / "runs" / "src1"
    (src / "code").mkdir(parents=True)
    (src / "config.json").write_text(json.dumps({
        "codes": ["BTC-USDT"], "source": "okx", "interval": "1D", "start_date": "2025-01-01",
        "end_date": "2025-06-01", "initial_cash": 10000, "warmup_bars": 50}))
    (src / "code" / "signal_engine.py").write_text("class SignalEngine:\n    pass\n")
    import src.paper_runs.service as svc
    monkeypatch.setattr(svc, "_run_backtest", _fake_backtest)
    import mcp_server
    return mcp_server


def _call(mod, name, args=None):
    import fastmcp

    async def go():
        async with fastmcp.Client(mod.mcp) as c:
            r = await c.call_tool(name, args or {}, raise_on_error=False)
            return r.content[0].text

    return json.loads(asyncio.run(go()))


def test_tools_listed(server):
    import fastmcp

    async def go():
        async with fastmcp.Client(server.mcp) as c:
            return {t.name for t in await c.list_tools()}

    assert NAMES <= asyncio.run(go())


def test_lifecycle(server):
    assert _call(server, "paper_run_list")["runs"] == []
    started = _call(server, "paper_run_start", {"run_id": "src1", "label": "x", "initial_cash": 5000})
    assert started["status"] == "ok"
    pid = started["run"]["id"]
    assert started["run"]["initial_cash"] == 5000
    runs = _call(server, "paper_run_list")["runs"]
    assert [r["id"] for r in runs] == [pid]

    st = _call(server, "paper_run_status", {"paper_run_id": pid, "max_trades": 5})
    assert st["run"]["state"] == "ok"
    assert len(st["equity"]) <= 50 and len(st["equity"]) > 2
    assert len(st["trades"]) == 5
    assert st["summary"] is not None

    st0 = _call(server, "paper_run_status", {"paper_run_id": pid, "refresh": False, "max_trades": 0})
    assert st0["trades"] == []

    stopped = _call(server, "paper_run_stop", {"paper_run_id": pid})
    assert stopped["run"]["status"] == "stopped"


def test_errors(server):
    nf = _call(server, "paper_run_status", {"paper_run_id": "deadbeef0000"})
    assert nf["status"] == "error" and nf["error_type"] == "not_found"
    assert _call(server, "paper_run_stop", {"paper_run_id": "deadbeef0000"})["error_type"] == "not_found"
    bad = _call(server, "paper_run_start", {"run_id": "../x"})
    assert bad["error_type"] == "invalid"
