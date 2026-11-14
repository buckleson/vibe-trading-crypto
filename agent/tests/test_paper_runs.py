"""Paper run service with a fake backtest writing synthetic artifacts."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

from src.paper_runs import PaperRunNotFound, PaperRuns
from src.paper_runs.service import forward_start

T0 = datetime(2025, 6, 10, 10, 30, tzinfo=timezone.utc)


def make_source(runs_dir: Path, run_id="src1", **over) -> str:
    d = runs_dir / run_id
    (d / "code").mkdir(parents=True)
    cfg = {"codes": ["BTC-USDT"], "source": "okx", "interval": "4H",
           "start_date": "2025-01-01", "end_date": "2025-06-01", "initial_cash": 10000,
           "warmup_bars": 50, "frozen_data_manifest": {"x": 1}}
    cfg.update(over)
    (d / "config.json").write_text(json.dumps(cfg))
    (d / "code" / "signal_engine.py").write_text("class SignalEngine:\n    pass\n")
    (d / "code" / "helper.py").write_text("X = 1\n")
    return run_id


class Fake:
    def __init__(self, response=None, raises=None, nan=False):
        self.response, self.raises, self.nan = response or json.dumps({"status": "ok"}), raises, nan
        self.configs: list[dict] = []

    def __call__(self, run_dir: str) -> str:
        if self.raises:
            raise self.raises
        d = Path(run_dir)
        self.configs.append(json.loads((d / "config.json").read_text()))
        assert not (d / "artifacts").exists()
        if json.loads(self.response)["status"] != "ok":
            return self.response
        a = d / "artifacts"
        a.mkdir()
        idx = pd.date_range("2025-06-11", periods=5, freq="D", name="timestamp")
        eq = pd.DataFrame({"ret": 0.0, "equity": [10000, 10100, 10300, 10200, 11000.0],
                           "drawdown": [0, 0, 0, -0.0097, 0], "benchmark_equity": 1.0,
                           "active_ret": 0.0}, index=idx)
        if self.nan:
            eq.loc[idx[1], "drawdown"] = float("nan")
        eq.to_csv(a / "equity.csv")
        pd.DataFrame({"timestamp": idx[:2], "code": "BTC-USDT", "side": ["buy", "sell"],
                      "price": [100.0, 110.0], "qty": [1.0, 1.0], "reason": ["sig", "sig"],
                      "pnl": [float("nan"), 10.0], "holding_days": [0, 1], "holding_bars": [0, 1],
                      "return_pct": [float("nan"), 0.1], "event": ["entry", "exit"]}
                     ).to_csv(a / "trades.csv", index=False)
        pd.DataFrame({"BTC-USDT": [0.0, 0.5, 0.5, 0.0, 0.0]}, index=idx).to_csv(a / "positions.csv")
        pd.DataFrame([{"sharpe": 1.5, "total_return": 0.1}]).to_csv(a / "metrics.csv", index=False)
        return self.response


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture
def env(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    make_source(runs)
    fake, clock = Fake(), Clock()
    svc = PaperRuns(tmp_path / "paper-runs", clock=clock, backtest=fake, runs_dir=runs)
    return svc, fake, clock, runs


def test_create_document(env):
    svc, _, _, _ = env
    doc = svc.create(run_id="src1")
    assert doc["label"] == "BTC-USDT paper"
    assert doc["initial_cash"] == 10000
    assert doc["interval"] == "4H" and doc["source"] == "okx"
    assert doc["evaluation_start"] == "2025-06-10T12:00:00"
    assert doc["warmup_start"] == "2024-12-12"  # 180 days before
    assert (doc["status"], doc["state"], doc["stopped_at"], doc["summary"]) == ("active", "waiting", None, None)
    assert (svc.root / doc["id"] / "code" / "helper.py").is_file()
    assert svc.get(doc["id"]) == doc


def test_create_overrides_and_validation(env):
    svc, _, _, runs = env
    doc = svc.create(run_id="src1", label="x" * 200, initial_cash=5.0, warmup_days=10)
    assert len(doc["label"]) == 80 and doc["initial_cash"] == 5.0 and doc["warmup_start"] == "2025-05-31"
    with pytest.raises(ValueError, match="not found"):
        svc.create(run_id="nope")
    with pytest.raises(ValueError):
        svc.create(run_id="../etc")
    with pytest.raises(ValueError):
        svc.create(run_id="src1", initial_cash=0)
    with pytest.raises(ValueError):
        svc.create(run_id="src1", initial_cash=-1)
    (runs / "nosig").mkdir()
    (runs / "nosig" / "config.json").write_text(json.dumps({"codes": ["A"]}))
    with pytest.raises(ValueError, match="signal_engine"):
        svc.create(run_id="nosig")
    make_source(runs, "badint", interval="2H")
    with pytest.raises(ValueError, match="interval"):
        svc.create(run_id="badint")


def test_forward_start():
    assert forward_start(T0, "1D") == "2025-06-11"
    assert forward_start(T0, "1W") == "2025-06-11"
    assert forward_start(T0, "4H") == "2025-06-10T12:00:00"
    assert forward_start(T0, "15m") == "2025-06-10T10:45:00"
    exact = datetime(2025, 6, 10, 12, 0, tzinfo=timezone.utc)
    assert forward_start(exact, "4H") == "2025-06-10T16:00:00"
    assert forward_start(exact, "1H") == "2025-06-10T13:00:00"
    late = datetime(2025, 6, 10, 23, 59, tzinfo=timezone.utc)
    assert forward_start(late, "4H") == "2025-06-11T00:00:00"


def test_refresh_config_and_summary(env):
    svc, fake, clock, _ = env
    doc = svc.create(run_id="src1")
    clock.t = T0 + timedelta(days=5)
    d = svc.refresh(doc["id"])
    cfg = fake.configs[-1]
    assert cfg["evaluation_start_date"] == doc["evaluation_start"]
    assert cfg["start_date"] == doc["warmup_start"]
    assert cfg["end_date"] == "2025-06-15"
    assert cfg["initial_cash"] == 10000
    assert "warmup_bars" not in cfg and "frozen_data_manifest" not in cfg
    r = d["run"]
    assert r["state"] == "ok" and r["last_error"] is None
    assert r["last_refreshed_at"] == clock.t.isoformat()
    s = r["summary"]
    assert s["equity"] == 11000 and s["pnl"] == 1000 and s["total_return"] == pytest.approx(0.1)
    assert s["max_drawdown"] == pytest.approx(-0.0097) and s["sharpe"] == 1.5
    assert s["trade_count"] == 2 and s["bars"] == 5 and s["as_of"].startswith("2025-06-15")
    assert len(d["equity"]) == 5
    assert [t["event"] for t in d["trades"]] == ["exit", "entry"]  # newest first
    assert d["positions"] == []  # last weight is zero
    assert svc.get(doc["id"])["state"] == "ok"


def test_waiting_state(env):
    svc, fake, _, _ = env
    doc = svc.create(run_id="src1")
    fake.response = json.dumps({"status": "error", "stderr": "ValueError: nothing would be evaluated"})
    d = svc.refresh(doc["id"])
    assert d["run"]["state"] == "waiting" and d["run"]["last_error"] is None and d["run"]["summary"] is None


def test_waiting_clears_stale_summary(env):
    svc, fake, _, _ = env
    doc = svc.create(run_id="src1")
    assert svc.refresh(doc["id"])["run"]["summary"]
    fake.response = json.dumps({"status": "error", "error": "No data fetched"})
    d = svc.refresh(doc["id"])
    assert d["run"]["summary"] is None and d["equity"] == []


def test_error_states(env):
    svc, fake, _, _ = env
    doc = svc.create(run_id="src1")
    fake.response = json.dumps({"status": "error", "error": "boom " * 300})
    r = svc.refresh(doc["id"])["run"]
    assert r["state"] == "error" and len(r["last_error"]) == 500
    fake.raises = RuntimeError("kaput")
    r = svc.refresh(doc["id"])["run"]
    assert r["state"] == "error" and "kaput" in r["last_error"]


def test_stop_freezes_end_date(env):
    svc, fake, clock, _ = env
    doc = svc.create(run_id="src1")
    clock.t = T0 + timedelta(days=2)
    s = svc.stop(doc["id"])["run"]
    assert s["status"] == "stopped" and s["stopped_at"] == clock.t.isoformat()
    first = s["stopped_at"]
    clock.t = T0 + timedelta(days=9)
    assert svc.stop(doc["id"])["run"]["stopped_at"] == first
    svc.refresh(doc["id"])
    assert fake.configs[-1]["end_date"] == "2025-06-12"


def test_list_order_get_delete(env):
    svc, _, clock, _ = env
    a = svc.create(run_id="src1")
    clock.t = T0 + timedelta(hours=1)
    b = svc.create(run_id="src1")
    assert [d["id"] for d in svc.list()] == [b["id"], a["id"]]
    svc.delete(a["id"])
    assert [d["id"] for d in svc.list()] == [b["id"]]
    with pytest.raises(PaperRunNotFound):
        svc.get(a["id"])
    with pytest.raises(PaperRunNotFound):
        svc.delete(a["id"])
    with pytest.raises(PaperRunNotFound):
        svc.get("../../etc")


def test_detail_without_artifacts(env):
    svc, _, _, _ = env
    d = svc.detail(svc.create(run_id="src1")["id"])
    assert d["equity"] == [] and d["trades"] == [] and d["positions"] == []


def test_nan_becomes_none_and_positions(env):
    svc, fake, _, _ = env
    fake.nan = True
    doc = svc.create(run_id="src1")
    d = svc.refresh(doc["id"])
    assert d["equity"][1]["drawdown"] is None
    assert d["trades"][1]["pnl"] is None and d["trades"][1]["return_pct"] is None
    json.dumps(d, allow_nan=False)
    pos = svc.root / doc["id"] / "artifacts" / "positions.csv"
    pd.DataFrame({"BTC-USDT": [0.0, 0.4], "ETH-USDT": [0.0, 0.0]},
                 index=pd.Index(["a", "b"], name="timestamp")).to_csv(pos)
    assert svc.detail(doc["id"])["positions"] == [{"symbol": "BTC-USDT", "weight": 0.4}]
