"""T04 acceptance tests: paper runs (forward paper trading of backtested strategies).

Offline and deterministic: the backtest engine is replaced by a fake callable
that writes synthetic artifacts, and the clock is injected. No exchange or
Anthropic API is ever contacted.
"""

from __future__ import annotations

import json
import math
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

# Import api_server at module top (before any test sets VIBE_TRADING_HOME) so
# its import-time path constants stay on the conftest sandbox; see T04 handoff.
from api_server import app

import src.paper_runs.service as svc_mod
from src.paper_runs import PaperRunNotFound, PaperRuns
from src.paper_runs.service import INTERVAL_MINUTES, WARMUP_DAYS, forward_start

REPO = Path(__file__).resolve().parents[3]
UTC = timezone.utc
T0 = datetime(2025, 6, 10, 10, 30, tzinfo=UTC)
DOC_KEYS = {
    "id", "label", "source_run_id", "codes", "source", "interval", "initial_cash",
    "started_at", "evaluation_start", "warmup_start", "status", "stopped_at",
    "last_refreshed_at", "state", "last_error", "summary",
}
SUMMARY_KEYS = {"equity", "pnl", "total_return", "max_drawdown", "sharpe",
                "trade_count", "bars", "as_of"}
TRADE_KEYS = {"time", "symbol", "side", "price", "qty", "pnl", "return_pct", "event", "reason"}


# --------------------------------------------------------------------------- helpers


def make_source(runs_dir: Path, run_id: str = "src1", *, config: dict | None = None,
                drop: tuple[str, ...] = (), signal: bool = True, extra_files: dict | None = None,
                raw_config: str | None = None) -> str:
    d = runs_dir / run_id
    (d / "code").mkdir(parents=True, exist_ok=True)
    cfg = {"codes": ["BTC-USDT"], "source": "okx", "interval": "4H",
           "start_date": "2025-01-01", "end_date": "2025-06-01", "initial_cash": 10000,
           "warmup_bars": 50, "frozen_data_manifest": {"x": 1}, "custom_key": "keep-me"}
    cfg.update(config or {})
    for k in drop:
        cfg.pop(k, None)
    (d / "config.json").write_text(raw_config if raw_config is not None else json.dumps(cfg))
    if signal:
        (d / "code" / "signal_engine.py").write_text("class SignalEngine:\n    pass\n")
    (d / "code" / "helper.py").write_text("X = 1\n")
    (d / "code" / "notes.txt").write_text("not python\n")
    for name, text in (extra_files or {}).items():
        (d / name).parent.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(text)
    return run_id


class FakeBacktest:
    """Fake ``run_backtest``: records configs and writes synthetic artifacts."""

    def __init__(self, response=None, raises: BaseException | None = None, *,
                 equity=(10000.0, 10100.0, 10300.0, 10200.0, 11000.0),
                 drawdown=(0.0, 0.0, 0.0, -0.0097, 0.0),
                 metrics: dict | None = None, write_metrics=True, write_trades=True,
                 write_equity=True, positions_last=None, sleep=0.0):
        self.response = response if response is not None else json.dumps({"status": "ok"})
        self.raises = raises
        self.equity, self.drawdown = list(equity), list(drawdown)
        self.metrics = {"sharpe": 1.5, "total_return": 0.1} if metrics is None else metrics
        self.write_metrics, self.write_trades, self.write_equity = write_metrics, write_trades, write_equity
        self.positions_last = positions_last
        self.sleep = sleep
        self.configs: list[dict] = []
        self.calls: list[str] = []
        self.artifacts_existed: list[bool] = []
        self.active = 0
        self.max_active = 0
        self._guard = threading.Lock()

    def __call__(self, run_dir: str) -> str:
        with self._guard:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self.sleep:
                time.sleep(self.sleep)
            self.calls.append(run_dir)
            d = Path(run_dir)
            self.artifacts_existed.append((d / "artifacts").exists())
            self.configs.append(json.loads((d / "config.json").read_text()))
            if self.raises is not None:
                raise self.raises
            try:
                ok = json.loads(self.response).get("status") == "ok"
            except Exception:
                ok = False
            if not ok:
                return self.response
            a = d / "artifacts"
            a.mkdir()
            n = len(self.equity)
            idx = pd.date_range("2025-06-11", periods=n, freq="D", name="timestamp")
            if self.write_equity:
                pd.DataFrame({"ret": 0.0, "equity": self.equity, "drawdown": self.drawdown,
                              "benchmark_equity": 1.0, "active_ret": 0.0}, index=idx).to_csv(a / "equity.csv")
            if self.write_trades:
                pd.DataFrame({"timestamp": idx[:2], "code": "BTC-USDT", "side": ["buy", "sell"],
                              "price": [100.0, 110.0], "qty": [1.0, 1.0], "reason": ["sig", "tp"],
                              "pnl": [float("nan"), 10.0], "holding_days": [0, 1], "holding_bars": [0, 1],
                              "return_pct": [float("nan"), 0.1], "event": ["entry", "exit"]}
                             ).to_csv(a / "trades.csv", index=False)
            last = self.positions_last or {"BTC-USDT": 0.0}
            rows = {k: [0.0] * (n - 1) + [v] for k, v in last.items()}
            pd.DataFrame(rows, index=idx).to_csv(a / "positions.csv")
            if self.write_metrics:
                pd.DataFrame([self.metrics]).to_csv(a / "metrics.csv", index=False)
            return self.response
        finally:
            with self._guard:
                self.active -= 1


class Clock:
    def __init__(self, t: datetime = T0):
        self.t = t

    def __call__(self) -> datetime:
        return self.t


@pytest.fixture
def env(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    make_source(runs)
    fake, clock = FakeBacktest(), Clock()
    svc = PaperRuns(tmp_path / "paper-runs", clock=clock, backtest=fake, runs_dir=runs)
    return svc, fake, clock, runs


def _paper_dir(svc: PaperRuns, pid: str) -> Path:
    return svc.root / pid


# --------------------------------------------------------------------------- constants


def test_constants_match_spec():
    assert WARMUP_DAYS == {"1m": 7, "5m": 14, "15m": 30, "30m": 45, "1H": 90,
                           "4H": 180, "1D": 400, "1W": 1500, "1M": 3000}
    assert INTERVAL_MINUTES == {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1H": 60, "4H": 240}


def test_package_exports():
    import src.paper_runs as pkg

    assert pkg.PaperRuns is svc_mod.PaperRuns
    assert pkg.PaperRunNotFound is svc_mod.PaperRunNotFound
    assert issubclass(PaperRunNotFound, KeyError)
    assert callable(svc_mod._run_backtest)


# --------------------------------------------------------------------------- forward_start


@pytest.mark.parametrize("started, interval, expected", [
    # daily-ish: next UTC calendar date
    (datetime(2025, 6, 10, 10, 30, tzinfo=UTC), "1D", "2025-06-11"),
    (datetime(2025, 6, 10, 0, 0, tzinfo=UTC), "1D", "2025-06-11"),          # exact midnight
    (datetime(2025, 6, 10, 23, 59, 59, tzinfo=UTC), "1D", "2025-06-11"),
    (datetime(2025, 6, 10, 10, 30, tzinfo=UTC), "1W", "2025-06-11"),
    (datetime(2025, 6, 10, 10, 30, tzinfo=UTC), "1M", "2025-06-11"),
    (datetime(2025, 12, 31, 12, 0, tzinfo=UTC), "1D", "2026-01-01"),         # year rollover
    (datetime(2024, 2, 28, 12, 0, tzinfo=UTC), "1D", "2024-02-29"),          # leap day
    # 4H
    (datetime(2025, 6, 10, 10, 30, tzinfo=UTC), "4H", "2025-06-10T12:00:00"),
    (datetime(2025, 6, 10, 8, 0, tzinfo=UTC), "4H", "2025-06-10T12:00:00"),   # exact boundary -> next
    (datetime(2025, 6, 10, 0, 0, tzinfo=UTC), "4H", "2025-06-10T04:00:00"),   # midnight boundary
    (datetime(2025, 6, 10, 22, 0, tzinfo=UTC), "4H", "2025-06-11T00:00:00"),  # day rollover
    (datetime(2025, 6, 10, 21, 59, 59, tzinfo=UTC), "4H", "2025-06-11T00:00:00"),
    # 1H
    (datetime(2025, 12, 31, 23, 0, tzinfo=UTC), "1H", "2026-01-01T00:00:00"),
    (datetime(2025, 6, 10, 10, 0, 0, 1, tzinfo=UTC), "1H", "2025-06-10T11:00:00"),  # 1 microsecond past
    # 30m / 15m / 5m / 1m
    (datetime(2025, 6, 10, 10, 30, tzinfo=UTC), "30m", "2025-06-10T11:00:00"),
    (datetime(2025, 6, 10, 10, 15, tzinfo=UTC), "15m", "2025-06-10T10:30:00"),  # exact boundary
    (datetime(2025, 6, 10, 10, 14, 59, 999999, tzinfo=UTC), "15m", "2025-06-10T10:15:00"),
    (datetime(2025, 6, 10, 10, 31, tzinfo=UTC), "15m", "2025-06-10T10:45:00"),
    (datetime(2025, 6, 10, 23, 57, tzinfo=UTC), "5m", "2025-06-11T00:00:00"),
    (datetime(2025, 6, 10, 10, 30, 45, tzinfo=UTC), "1m", "2025-06-10T10:31:00"),
    (datetime(2025, 6, 10, 10, 30, 0, tzinfo=UTC), "1m", "2025-06-10T10:31:00"),
])
def test_forward_start_table(started, interval, expected):
    assert forward_start(started, interval) == expected


def test_forward_start_converts_other_timezones_to_utc():
    plus5 = timezone(timedelta(hours=5))
    started = datetime(2025, 6, 10, 3, 30, tzinfo=plus5)  # 2025-06-09T22:30Z
    assert forward_start(started, "1D") == "2025-06-10"
    assert forward_start(started, "4H") == "2025-06-10T00:00:00"
    minus8 = timezone(timedelta(hours=-8))
    late = datetime(2025, 6, 10, 20, 0, tzinfo=minus8)  # 2025-06-11T04:00Z exact 4H boundary
    assert forward_start(late, "4H") == "2025-06-11T08:00:00"
    assert forward_start(late, "1D") == "2025-06-12"


def test_forward_start_naive_is_treated_as_utc():
    assert forward_start(datetime(2025, 6, 10, 10, 30), "4H") == "2025-06-10T12:00:00"
    assert forward_start(datetime(2025, 6, 10, 10, 30), "1D") == "2025-06-11"


@pytest.mark.parametrize("interval", sorted(INTERVAL_MINUTES))
@pytest.mark.parametrize("minute_of_day", [0, 1, 59, 60, 239, 240, 721, 1439])
def test_forward_start_intraday_invariants(interval, minute_of_day):
    started = datetime(2025, 3, 1, tzinfo=UTC) + timedelta(minutes=minute_of_day, seconds=7)
    out = forward_start(started, interval)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", out)
    nxt = datetime.fromisoformat(out).replace(tzinfo=UTC)
    step = timedelta(minutes=INTERVAL_MINUTES[interval])
    assert started < nxt <= started + step
    since_midnight = nxt - nxt.replace(hour=0, minute=0, second=0)
    assert since_midnight % step == timedelta(0)


@pytest.mark.parametrize("interval", ["1D", "1W", "1M"])
def test_forward_start_daily_format(interval):
    out = forward_start(T0, interval)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", out)


# --------------------------------------------------------------------------- create: happy paths


def test_create_document_shape_and_defaults(env):
    svc, fake, _, _ = env
    doc = svc.create(run_id="src1")
    assert set(doc) == DOC_KEYS
    assert re.fullmatch(r"[0-9a-f]{12}", doc["id"])
    assert doc["source_run_id"] == "src1"
    assert doc["codes"] == ["BTC-USDT"]
    assert doc["source"] == "okx"
    assert doc["interval"] == "4H"
    assert doc["initial_cash"] == 10000.0
    assert doc["label"] == "BTC-USDT paper"
    assert doc["status"] == "active" and doc["state"] == "waiting"
    for k in ("stopped_at", "last_refreshed_at", "last_error", "summary"):
        assert doc[k] is None
    assert datetime.fromisoformat(doc["started_at"]) == T0
    assert doc["started_at"].endswith("+00:00")
    assert doc["evaluation_start"] == "2025-06-10T12:00:00"
    assert doc["warmup_start"] == (T0.date() - timedelta(days=180)).isoformat()
    assert fake.calls == []  # create never refreshes


def test_create_persists_document_and_source_config(env):
    svc, _, _, runs = env
    doc = svc.create(run_id="src1")
    d = _paper_dir(svc, doc["id"])
    assert json.loads((d / "paper_run.json").read_text()) == doc
    assert json.loads((d / "source_config.json").read_text()) == json.loads((runs / "src1" / "config.json").read_text())
    assert (d / "code" / "signal_engine.py").read_text() == "class SignalEngine:\n    pass\n"
    assert (d / "code" / "helper.py").is_file()
    assert not (d / "code" / "notes.txt").exists()  # only *.py copied
    assert not (d / "config.json").exists()  # config only written on refresh
    assert not list(d.glob("*.tmp")) and not list(d.rglob("*.tmp"))  # atomic writes leave no tmp files


def test_create_lives_under_root_not_runs_dir(env):
    svc, _, _, runs = env
    doc = svc.create(run_id="src1")
    assert _paper_dir(svc, doc["id"]).is_dir()
    assert not (runs / doc["id"]).exists()
    assert sorted(p.name for p in runs.iterdir()) == ["src1"]


def test_create_overrides(env):
    svc, _, _, _ = env
    doc = svc.create(run_id="src1", label="My run", initial_cash=2500.5, warmup_days=3)
    assert doc["label"] == "My run"
    assert doc["initial_cash"] == 2500.5
    assert doc["warmup_start"] == "2025-06-07"


def test_create_label_default_uses_first_three_codes_and_trims(tmp_path):
    runs = tmp_path / "runs"
    codes = [f"COIN{i}-USDT" for i in range(5)]
    make_source(runs, config={"codes": codes})
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    assert svc.create(run_id="src1")["label"] == "COIN0-USDT, COIN1-USDT, COIN2-USDT paper"
    long_codes = ["X" * 60, "Y" * 60]
    make_source(runs, "long", config={"codes": long_codes})
    lbl = svc.create(run_id="long")["label"]
    assert len(lbl) == 80 and lbl.startswith("X" * 60)
    assert len(svc.create(run_id="src1", label="z" * 200)["label"]) == 80


def test_create_defaults_when_config_keys_absent(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs, drop=("source", "interval", "initial_cash"))
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    doc = svc.create(run_id="src1")
    assert doc["source"] == "auto"
    assert doc["interval"] == "1D"
    assert doc["initial_cash"] == 100000.0
    assert doc["evaluation_start"] == "2025-06-11"
    assert doc["warmup_start"] == (T0.date() - timedelta(days=400)).isoformat()


@pytest.mark.parametrize("interval", sorted(WARMUP_DAYS))
def test_create_every_valid_interval(tmp_path, interval):
    runs = tmp_path / "runs"
    make_source(runs, config={"interval": interval})
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    doc = svc.create(run_id="src1")
    assert doc["interval"] == interval
    assert doc["evaluation_start"] == forward_start(T0, interval)
    assert doc["warmup_start"] == (T0.date() - timedelta(days=WARMUP_DAYS[interval])).isoformat()


def test_create_ids_are_unique(env):
    svc, _, _, _ = env
    ids = {svc.create(run_id="src1")["id"] for _ in range(20)}
    assert len(ids) == 20


def test_create_accepts_200_char_run_id(tmp_path):
    runs = tmp_path / "runs"
    rid = "a" * 200
    try:
        make_source(runs, rid)
    except OSError:
        pytest.skip("filesystem rejects 200-char names")
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    assert svc.create(run_id=rid)["source_run_id"] == rid


def test_create_non_utc_clock_stores_utc(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    t = datetime(2025, 6, 10, 3, 30, tzinfo=timezone(timedelta(hours=5)))
    svc = PaperRuns(tmp_path / "pr", clock=Clock(t), backtest=FakeBacktest(), runs_dir=runs)
    doc = svc.create(run_id="src1")
    assert doc["started_at"] == "2025-06-09T22:30:00+00:00"
    assert doc["evaluation_start"] == "2025-06-10T00:00:00"
    assert doc["warmup_start"] == (datetime(2025, 6, 9).date() - timedelta(days=180)).isoformat()


# --------------------------------------------------------------------------- create: invalid inputs


@pytest.mark.parametrize("bad", ["", ".", "..", "../src1", "a/b", "a\\b", "has space", "x" * 201,
                                 "src1\n", "émoji", None, 123])
def test_create_rejects_bad_run_id(env, bad):
    svc, _, _, _ = env
    with pytest.raises(ValueError):
        svc.create(run_id=bad)
    assert not svc.root.exists() or list(svc.root.iterdir()) == []


def test_create_missing_run(env):
    svc, _, _, _ = env
    with pytest.raises(ValueError, match="not found"):
        svc.create(run_id="nope")


def test_create_missing_signal_engine(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs, signal=False)
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    with pytest.raises(ValueError, match="signal_engine"):
        svc.create(run_id="src1")
    assert not svc.root.exists() or list(svc.root.iterdir()) == []


def test_create_invalid_json_config(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs, raw_config="{not json")
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    with pytest.raises(ValueError, match="JSON"):
        svc.create(run_id="src1")


@pytest.mark.parametrize("codes", [None, [], "BTC-USDT", [1, 2], ["BTC-USDT", None]])
def test_create_rejects_bad_codes(tmp_path, codes):
    runs = tmp_path / "runs"
    if codes is None:
        make_source(runs, drop=("codes",))
    else:
        make_source(runs, config={"codes": codes})
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    with pytest.raises(ValueError, match="codes"):
        svc.create(run_id="src1")


@pytest.mark.parametrize("interval", ["2H", "1d", "1h", "", "daily", "4h"])
def test_create_rejects_bad_interval(tmp_path, interval):
    runs = tmp_path / "runs"
    make_source(runs, config={"interval": interval})
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    with pytest.raises(ValueError, match="interval"):
        svc.create(run_id="src1")


@pytest.mark.parametrize("cash", [0, 0.0, -1, -1e-9, float("nan"), float("inf"), float("-inf"), "abc"])
def test_create_rejects_non_positive_or_non_finite_cash(env, cash):
    svc, _, _, _ = env
    with pytest.raises(ValueError, match="initial_cash"):
        svc.create(run_id="src1", initial_cash=cash)


@pytest.mark.parametrize("cfg_cash", [0, -500, "lots"])
def test_create_rejects_bad_cash_from_config(tmp_path, cfg_cash):
    runs = tmp_path / "runs"
    make_source(runs, config={"initial_cash": cfg_cash})
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(), runs_dir=runs)
    with pytest.raises(ValueError, match="initial_cash"):
        svc.create(run_id="src1")
    # An explicit valid override wins over a bad config value.
    assert svc.create(run_id="src1", initial_cash=5.0)["initial_cash"] == 5.0


@pytest.mark.parametrize("days", [0, -1])
def test_create_rejects_bad_warmup_days(env, days):
    svc, _, _, _ = env
    with pytest.raises(ValueError, match="warmup_days"):
        svc.create(run_id="src1", warmup_days=days)


# --------------------------------------------------------------------------- get / list / detail


@pytest.mark.parametrize("bad", ["", "ABCDEF123456", "abcdef12345", "abcdef1234567", "../../etc/x",
                                 "ghijklmnopqr", None, 12])
def test_get_rejects_malformed_ids(env, bad):
    svc, _, _, _ = env
    with pytest.raises(PaperRunNotFound):
        svc.get(bad)
    with pytest.raises(PaperRunNotFound):
        svc.detail(bad)
    with pytest.raises(PaperRunNotFound):
        svc.refresh(bad)
    with pytest.raises(PaperRunNotFound):
        svc.stop(bad)
    with pytest.raises(PaperRunNotFound):
        svc.delete(bad)


def test_unknown_well_formed_id_not_found(env):
    svc, fake, _, _ = env
    for fn in (svc.get, svc.detail, svc.refresh, svc.stop, svc.delete):
        with pytest.raises(PaperRunNotFound):
            fn("abcdef123456")
    assert fake.calls == []


def test_get_corrupt_document_not_found_and_list_skips_it(env):
    svc, _, _, _ = env
    good = svc.create(run_id="src1")
    bad = svc.create(run_id="src1")
    (_paper_dir(svc, bad["id"]) / "paper_run.json").write_text("{broken")
    with pytest.raises(PaperRunNotFound):
        svc.get(bad["id"])
    assert [d["id"] for d in svc.list()] == [good["id"]]


def test_list_empty_when_root_missing(tmp_path):
    svc = PaperRuns(tmp_path / "does-not-exist", clock=Clock(), backtest=FakeBacktest(), runs_dir=tmp_path)
    assert svc.list() == []


def test_list_newest_first_and_ignores_foreign_dirs(env):
    svc, _, clock, _ = env
    ids = []
    for h in (0, 5, 2):
        clock.t = T0 + timedelta(hours=h)
        ids.append(svc.create(run_id="src1")["id"])
    (svc.root / "not-an-id").mkdir()
    (svc.root / "not-an-id" / "paper_run.json").write_text(json.dumps({"id": "x", "started_at": "9999"}))
    (svc.root / "abcdef123456").mkdir()  # well-formed id but no document
    (svc.root / "stray.txt").write_text("x")
    assert [d["id"] for d in svc.list()] == [ids[1], ids[2], ids[0]]


def test_detail_without_artifacts_is_empty(env):
    svc, _, _, _ = env
    doc = svc.create(run_id="src1")
    d = svc.detail(doc["id"])
    assert d == {"run": doc, "equity": [], "trades": [], "positions": []}


def test_detail_reads_artifacts(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    d = svc.refresh(pid)
    assert set(d) == {"run", "equity", "trades", "positions"}
    assert len(d["equity"]) == 5
    assert d["equity"][0] == {"time": "2025-06-11", "equity": 10000.0, "drawdown": 0.0}
    assert d["equity"][-1]["time"] == "2025-06-15"
    assert d["equity"][3]["drawdown"] == pytest.approx(-0.0097)
    assert [t["event"] for t in d["trades"]] == ["exit", "entry"]  # newest first
    for t in d["trades"]:
        assert set(t) == TRADE_KEYS
    exit_, entry = d["trades"]
    assert exit_ == {"time": "2025-06-12", "symbol": "BTC-USDT", "side": "sell", "price": 110.0,
                     "qty": 1.0, "pnl": 10.0, "return_pct": 0.1, "event": "exit", "reason": "tp"}
    assert entry["pnl"] is None and entry["return_pct"] is None  # NaN -> None
    assert d["positions"] == []  # last row flat
    json.dumps(d, allow_nan=False)  # strictly JSON-serialisable


def test_detail_positions_last_row_filters_tiny_and_keeps_shorts(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    fake = FakeBacktest(positions_last={"BTC-USDT": 0.6, "ETH-USDT": -0.25, "SOL-USDT": 1e-12})
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=fake, runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    pos = svc.refresh(pid)["positions"]
    assert pos == [{"symbol": "BTC-USDT", "weight": 0.6}, {"symbol": "ETH-USDT", "weight": -0.25}]


def test_detail_nan_equity_and_drawdown_become_none(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    fake = FakeBacktest(equity=(10000.0, float("nan"), 10500.0), drawdown=(0.0, float("nan"), -0.01))
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=fake, runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    d = svc.refresh(pid)
    assert d["equity"][1]["equity"] is None and d["equity"][1]["drawdown"] is None
    assert d["run"]["summary"]["max_drawdown"] == pytest.approx(-0.01)
    json.dumps(d, allow_nan=False)


def test_detail_tolerates_garbage_artifacts(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    a = _paper_dir(svc, pid) / "artifacts"
    a.mkdir()
    (a / "equity.csv").write_text("")              # empty file -> parse error
    (a / "trades.csv").write_bytes(b"\x00\xff\xfe")  # binary junk
    (a / "positions.csv").write_text("timestamp\n")  # header only
    d = svc.detail(pid)
    assert d["equity"] == [] and d["positions"] == []
    assert isinstance(d["trades"], list)


def test_detail_does_not_recompute(env):
    svc, fake, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc.detail(pid)
    svc.get(pid)
    assert fake.calls == []


# --------------------------------------------------------------------------- refresh: config


def test_refresh_writes_forward_config(env):
    svc, fake, _, runs = env
    doc = svc.create(run_id="src1")
    svc.refresh(doc["id"])
    assert fake.calls == [str(_paper_dir(svc, doc["id"]))]
    cfg = fake.configs[0]
    on_disk = json.loads((_paper_dir(svc, doc["id"]) / "config.json").read_text())
    assert cfg == on_disk
    assert cfg["start_date"] == doc["warmup_start"]
    assert cfg["end_date"] == "2025-06-10"
    assert cfg["evaluation_start_date"] == doc["evaluation_start"] == "2025-06-10T12:00:00"
    assert cfg["initial_cash"] == 10000.0
    assert "warmup_bars" not in cfg and "frozen_data_manifest" not in cfg
    assert cfg["codes"] == ["BTC-USDT"] and cfg["source"] == "okx" and cfg["interval"] == "4H"
    assert cfg["custom_key"] == "keep-me"
    # Source backtest run is never modified.
    src_cfg = json.loads((runs / "src1" / "config.json").read_text())
    assert src_cfg["warmup_bars"] == 50 and src_cfg["end_date"] == "2025-06-01"


def test_refresh_uses_overridden_cash_and_moving_end_date(env):
    svc, fake, clock, _ = env
    pid = svc.create(run_id="src1", initial_cash=777.0)["id"]
    svc.refresh(pid)
    clock.t = T0 + timedelta(days=3, hours=20)  # 2025-06-14T06:30Z
    svc.refresh(pid)
    assert [c["end_date"] for c in fake.configs] == ["2025-06-10", "2025-06-14"]
    assert all(c["initial_cash"] == 777.0 for c in fake.configs)
    # evaluation_start / warmup_start are fixed at create time
    assert len({c["evaluation_start_date"] for c in fake.configs}) == 1
    assert len({c["start_date"] for c in fake.configs}) == 1


def test_refresh_end_date_uses_utc_date(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    fake, clock = FakeBacktest(), Clock()
    svc = PaperRuns(tmp_path / "pr", clock=clock, backtest=fake, runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    clock.t = datetime(2025, 6, 11, 1, 0, tzinfo=timezone(timedelta(hours=5)))  # 2025-06-10T20:00Z
    svc.refresh(pid)
    assert fake.configs[0]["end_date"] == "2025-06-10"


def test_refresh_never_sets_both_warmup_bars_and_evaluation_start(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs, config={"warmup_bars": 999, "evaluation_start_date": "2020-01-01"})
    fake = FakeBacktest()
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=fake, runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    svc.refresh(pid)
    cfg = fake.configs[0]
    assert "warmup_bars" not in cfg
    assert cfg["evaluation_start_date"] == "2025-06-10T12:00:00"  # source value overridden


def test_refresh_deletes_stale_artifacts_before_running(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    a = _paper_dir(svc, pid) / "artifacts"
    a.mkdir()
    (a / "equity.csv").write_text("timestamp,equity,drawdown\n2020-01-01,1,0\n")
    waiting = FakeBacktest(response=json.dumps({"status": "error", "error": "nothing would be evaluated"}))
    svc._backtest = waiting
    d = svc.refresh(pid)
    assert waiting.artifacts_existed == [False]
    assert not a.exists()
    assert d["equity"] == []


def test_refresh_sets_and_persists_last_refreshed_at(env):
    svc, _, clock, _ = env
    pid = svc.create(run_id="src1")["id"]
    clock.t = T0 + timedelta(hours=1)
    d = svc.refresh(pid)
    assert d["run"]["last_refreshed_at"] == (T0 + timedelta(hours=1)).isoformat()
    assert svc.get(pid)["last_refreshed_at"] == d["run"]["last_refreshed_at"]
    assert not list(_paper_dir(svc, pid).glob("*.tmp"))


# --------------------------------------------------------------------------- refresh: summary


def test_refresh_ok_summary_math(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    run = svc.refresh(pid)["run"]
    assert run["state"] == "ok" and run["last_error"] is None
    s = run["summary"]
    assert set(s) == SUMMARY_KEYS
    assert s["equity"] == 11000.0
    assert s["pnl"] == pytest.approx(1000.0)
    assert s["total_return"] == pytest.approx(0.1)
    assert s["max_drawdown"] == pytest.approx(-0.0097)
    assert s["max_drawdown"] <= 0
    assert s["sharpe"] == pytest.approx(1.5)
    assert s["trade_count"] == 2
    assert s["bars"] == 5
    assert s["as_of"] == "2025-06-15"
    assert svc.get(pid)["summary"] == s  # persisted


def test_summary_loss_and_override_cash(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    fake = FakeBacktest(equity=(2000.0, 1800.0, 1500.0), drawdown=(0.0, -0.1, -0.25))
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=fake, runs_dir=runs)
    pid = svc.create(run_id="src1", initial_cash=2000.0)["id"]
    s = svc.refresh(pid)["run"]["summary"]
    assert s["pnl"] == pytest.approx(-500.0)
    assert s["total_return"] == pytest.approx(-0.25)
    assert s["max_drawdown"] == pytest.approx(-0.25)
    assert s["bars"] == 3


@pytest.mark.parametrize("metrics, expected", [
    ({"Sharpe Ratio": 2.25, "x": 1}, 2.25),
    ({"sharpe_ratio": -0.5}, -0.5),
    ({"total_return": 0.1}, None),
    ({"sharpe": float("nan")}, None),
])
def test_summary_sharpe_column_variants(tmp_path, metrics, expected):
    runs = tmp_path / "runs"
    make_source(runs)
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(metrics=metrics), runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    assert svc.refresh(pid)["run"]["summary"]["sharpe"] == expected


def test_summary_without_metrics_or_trades(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    fake = FakeBacktest(write_metrics=False, write_trades=False)
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=fake, runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    d = svc.refresh(pid)
    assert d["run"]["summary"]["sharpe"] is None
    assert d["run"]["summary"]["trade_count"] == 0
    assert d["trades"] == []


def test_ok_without_equity_csv_has_no_summary(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=FakeBacktest(write_equity=False), runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    run = svc.refresh(pid)["run"]
    assert run["state"] == "ok" and run["summary"] is None


# --------------------------------------------------------------------------- refresh: states


@pytest.mark.parametrize("envelope", [
    {"status": "error", "error": "ValueError: evaluation_start_date leaves nothing would be evaluated"},
    {"status": "error", "error": "the evaluation window would hold 1 bar"},
    {"status": "error", "error": "No data fetched for BTC-USDT"},
    {"status": "error", "error": "evaluation_start_date is after the last loaded bar"},
    {"status": "error", "stderr": "Traceback ... nothing would be evaluated"},  # marker in another field
    {"status": "error", "details": {"nested": "No data fetched"}},
])
def test_refresh_waiting_markers(env, envelope):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc._backtest = FakeBacktest(response=json.dumps(envelope))
    d = svc.refresh(pid)
    run = d["run"]
    assert run["state"] == "waiting" and run["last_error"] is None and run["summary"] is None
    assert run["last_refreshed_at"] is not None
    assert d["equity"] == []


def test_waiting_after_ok_clears_summary(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    assert svc.refresh(pid)["run"]["summary"] is not None
    svc._backtest = FakeBacktest(response=json.dumps({"status": "error", "error": "nothing would be evaluated"}))
    run = svc.refresh(pid)["run"]
    assert run["state"] == "waiting" and run["summary"] is None


def test_refresh_error_state_and_truncation(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    long_msg = "Strategy blew up: " + "x" * 2000
    svc._backtest = FakeBacktest(response=json.dumps({"status": "error", "error": long_msg}))
    run = svc.refresh(pid)["run"]
    assert run["state"] == "error"
    assert run["last_error"] == long_msg[:500]
    assert len(run["last_error"]) == 500
    assert run["summary"] is None
    assert svc.get(pid)["state"] == "error"


def test_refresh_error_falls_back_to_stderr_then_envelope(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc._backtest = FakeBacktest(response=json.dumps({"status": "error", "stderr": "segfault"}))
    assert svc.refresh(pid)["run"]["last_error"] == "segfault"
    svc._backtest = FakeBacktest(response=json.dumps({"status": "error", "code": 7}))
    msg = svc.refresh(pid)["run"]["last_error"]
    assert msg and "7" in msg


@pytest.mark.parametrize("raw", ["not json at all", "[1, 2]", "null", json.dumps({"no_status": True})])
def test_refresh_malformed_envelope_is_error(env, raw):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc._backtest = FakeBacktest(response=raw)
    run = svc.refresh(pid)["run"]
    assert run["state"] == "error" and run["last_error"]


def test_refresh_none_return_is_error(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc._backtest = lambda run_dir: None
    run = svc.refresh(pid)["run"]
    assert run["state"] == "error"


def test_refresh_exception_is_caught(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc._backtest = FakeBacktest(raises=RuntimeError("boom"))
    d = svc.refresh(pid)
    assert d["run"]["state"] == "error"
    assert d["run"]["last_error"] == "RuntimeError: boom"
    assert d["run"]["last_refreshed_at"] is not None


def test_exception_with_waiting_marker_is_waiting(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc._backtest = FakeBacktest(raises=ValueError("evaluation window would hold 1 bars"))
    assert svc.refresh(pid)["run"]["state"] == "waiting"


def test_recovery_from_error_clears_last_error(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc._backtest = FakeBacktest(raises=RuntimeError("boom"))
    assert svc.refresh(pid)["run"]["state"] == "error"
    svc._backtest = FakeBacktest()
    run = svc.refresh(pid)["run"]
    assert run["state"] == "ok" and run["last_error"] is None and run["summary"]


def test_default_backtest_is_module_patch_point_looked_up_at_call_time(tmp_path, monkeypatch):
    runs = tmp_path / "runs"
    make_source(runs)
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), runs_dir=runs)  # no backtest injected
    pid = svc.create(run_id="src1")["id"]
    fake = FakeBacktest()
    monkeypatch.setattr(svc_mod, "_run_backtest", fake)  # patched AFTER construction
    assert svc.refresh(pid)["run"]["state"] == "ok"
    assert len(fake.calls) == 1


def test_real_patch_point_delegates_to_backtest_tool(monkeypatch):
    import src.tools.backtest_tool as bt

    seen = []
    monkeypatch.setattr(bt, "run_backtest", lambda d: seen.append(d) or '{"status": "ok"}')
    assert svc_mod._run_backtest("/some/dir") == '{"status": "ok"}'
    assert seen == ["/some/dir"]


# --------------------------------------------------------------------------- stop / delete


def test_stop_freezes_end_date_and_is_idempotent(env):
    svc, fake, clock, _ = env
    pid = svc.create(run_id="src1")["id"]
    clock.t = T0 + timedelta(days=2)
    d = svc.stop(pid)
    assert d["run"]["status"] == "stopped"
    first_stop = d["run"]["stopped_at"]
    assert first_stop == (T0 + timedelta(days=2)).isoformat()
    assert set(d) == {"run", "equity", "trades", "positions"}
    clock.t = T0 + timedelta(days=9)
    assert svc.stop(pid)["run"]["stopped_at"] == first_stop
    d = svc.refresh(pid)
    assert fake.configs[-1]["end_date"] == "2025-06-12"  # stop date, not clock date
    assert d["run"]["status"] == "stopped" and d["run"]["stopped_at"] == first_stop
    assert d["run"]["last_refreshed_at"] == (T0 + timedelta(days=9)).isoformat()


def test_stop_does_not_run_backtest(env):
    svc, fake, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    svc.stop(pid)
    assert fake.calls == []


def test_stop_preserves_last_results(env):
    svc, _, _, _ = env
    pid = svc.create(run_id="src1")["id"]
    before = svc.refresh(pid)
    after = svc.stop(pid)
    assert after["equity"] == before["equity"]
    assert after["run"]["summary"] == before["run"]["summary"]


def test_delete_removes_only_paper_dir(env):
    svc, _, _, runs = env
    keep = svc.create(run_id="src1")["id"]
    pid = svc.create(run_id="src1")["id"]
    svc.refresh(pid)
    assert svc.delete(pid) is None
    assert not _paper_dir(svc, pid).exists()
    assert (runs / "src1" / "config.json").is_file()
    assert [d["id"] for d in svc.list()] == [keep]
    with pytest.raises(PaperRunNotFound):
        svc.delete(pid)
    with pytest.raises(PaperRunNotFound):
        svc.get(pid)


# --------------------------------------------------------------------------- concurrency


def test_concurrent_refresh_of_same_id_is_serialized(tmp_path):
    runs = tmp_path / "runs"
    make_source(runs)
    fake = FakeBacktest(sleep=0.05)
    svc = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=fake, runs_dir=runs)
    pid = svc.create(run_id="src1")["id"]
    errors = []

    def worker():
        try:
            other = PaperRuns(tmp_path / "pr", clock=Clock(), backtest=fake, runs_dir=runs)
            other.refresh(pid)
        except Exception as exc:  # pragma: no cover - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert not errors
    assert len(fake.calls) == 4
    assert fake.max_active == 1
    assert svc.get(pid)["state"] == "ok"


# --------------------------------------------------------------------------- paths


def test_default_roots_follow_vibe_trading_home(tmp_path, monkeypatch):
    from src.config.paths import get_runs_dir, get_runtime_root

    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path))
    svc = PaperRuns()
    assert svc.root == get_runtime_root() / "paper-runs"
    assert svc.runs_dir == get_runs_dir()
    assert not svc.root.resolve().is_relative_to(get_runs_dir().resolve())


def test_paper_runs_root_is_allowed_run_root(tmp_path, monkeypatch):
    from src.config.paths import get_runtime_root
    from src.tools.path_utils import _default_run_roots, safe_run_dir

    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path))
    roots = _default_run_roots()
    assert get_runtime_root() / "paper-runs" in roots
    d = tmp_path / "paper-runs" / "abcdef123456"
    d.mkdir(parents=True)
    assert safe_run_dir(str(d)) == d.resolve()
    with pytest.raises(ValueError):
        safe_run_dir(str(tmp_path / "elsewhere" / "abcdef123456"))


def test_service_paper_dir_accepted_by_safe_run_dir(tmp_path, monkeypatch):
    from src.tools.path_utils import safe_run_dir

    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path))
    make_source(tmp_path / "runs")
    fake = FakeBacktest()
    svc = PaperRuns(clock=Clock(), backtest=fake)
    pid = svc.create(run_id="src1")["id"]
    svc.refresh(pid)
    assert safe_run_dir(fake.calls[0]) == (tmp_path / "paper-runs" / pid).resolve()


# --------------------------------------------------------------------------- REST routes


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path))
    make_source(tmp_path / "runs")
    make_source(tmp_path / "runs", "nosig", signal=False)
    fake = FakeBacktest()
    monkeypatch.setattr(svc_mod, "_run_backtest", fake)
    client = TestClient(app, raise_server_exceptions=False)
    return client, fake, tmp_path


def test_routes_registered_once_with_methods():
    want = {
        ("/api/paper-runs", "GET"), ("/api/paper-runs", "POST"),
        ("/api/paper-runs/{paper_id}", "GET"), ("/api/paper-runs/{paper_id}", "DELETE"),
        ("/api/paper-runs/{paper_id}/refresh", "POST"), ("/api/paper-runs/{paper_id}/stop", "POST"),
    }
    seen = []
    for r in app.routes:
        path = getattr(r, "path", "")
        if path.startswith("/api/paper-runs"):
            for m in getattr(r, "methods", set()) or set():
                if m != "HEAD":
                    seen.append((path, m))
    assert set(seen) == want
    assert len(seen) == len(want)
    # Paper accounts routes still exist.
    assert any(getattr(r, "path", "") == "/api/paper-accounts" for r in app.routes)


def test_api_server_not_edited_for_paper_runs():
    text = (REPO / "agent" / "api_server.py").read_text(encoding="utf-8")
    assert "paper-runs" not in text and "paper_runs" not in text
    assert "register_paper_trade_routes" in text


def test_route_handlers_are_sync():
    import inspect

    for r in app.routes:
        if getattr(r, "path", "").startswith("/api/paper-runs"):
            assert not inspect.iscoroutinefunction(r.endpoint), r.path


def test_api_full_lifecycle(api):
    client, fake, tmp = api
    assert client.get("/api/paper-runs").json() == []
    r = client.post("/api/paper-runs", json={"run_id": "src1", "label": "Mine",
                                             "initial_cash": 5000, "warmup_days": 10})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert set(doc) == DOC_KEYS
    assert doc["label"] == "Mine" and doc["initial_cash"] == 5000.0 and doc["state"] == "waiting"
    pid = doc["id"]
    assert (tmp / "paper-runs" / pid / "paper_run.json").is_file()
    assert not (tmp / "runs" / pid).exists()

    d = client.get(f"/api/paper-runs/{pid}").json()
    assert d == {"run": doc, "equity": [], "trades": [], "positions": []}
    assert fake.calls == []

    d = client.post(f"/api/paper-runs/{pid}/refresh").json()
    assert d["run"]["state"] == "ok"
    assert d["run"]["summary"]["pnl"] == pytest.approx(11000.0 - 5000.0)
    assert len(d["equity"]) == 5 and d["trades"][0]["event"] == "exit"
    assert fake.configs[0]["initial_cash"] == 5000.0

    d = client.post(f"/api/paper-runs/{pid}/stop").json()
    assert d["run"]["status"] == "stopped" and d["run"]["stopped_at"]
    again = client.post(f"/api/paper-runs/{pid}/stop").json()
    assert again["run"]["stopped_at"] == d["run"]["stopped_at"]

    r = client.delete(f"/api/paper-runs/{pid}")
    assert r.status_code == 200 and r.json() == {"deleted": True}
    assert client.get(f"/api/paper-runs/{pid}").status_code == 404
    assert client.get("/api/paper-runs").json() == []


def test_api_list_order(api):
    client, _, _ = api
    a = client.post("/api/paper-runs", json={"run_id": "src1"}).json()
    time.sleep(0.01)
    b = client.post("/api/paper-runs", json={"run_id": "src1"}).json()
    assert [x["id"] for x in client.get("/api/paper-runs").json()] == [b["id"], a["id"]]


@pytest.mark.parametrize("pid", ["abcdef123456", "ABCDEF123456", "short", "zzzzzzzzzzzz", "abcdef1234567"])
@pytest.mark.parametrize("method, suffix", [("get", ""), ("post", "/refresh"), ("post", "/stop"), ("delete", "")])
def test_api_404(api, pid, method, suffix):
    client, fake, _ = api
    r = getattr(client, method)(f"/api/paper-runs/{pid}{suffix}")
    assert r.status_code == 404
    assert r.json()["detail"] == "Paper run not found"
    assert fake.calls == []


@pytest.mark.parametrize("body", [
    {},                                              # missing run_id
    {"run_id": ""},                                  # too short
    {"run_id": "a" * 201},                           # too long
    {"run_id": "src1", "label": "x" * 81},           # label too long
    {"run_id": "src1", "initial_cash": 0},
    {"run_id": "src1", "initial_cash": -10},
    {"run_id": "src1", "initial_cash": "inf"},
    {"run_id": "src1", "initial_cash": "NaN"},
    {"run_id": "src1", "initial_cash": "lots"},
    {"run_id": "src1", "warmup_days": 0},
    {"run_id": "src1", "warmup_days": 5001},
    {"run_id": "src1", "warmup_days": 1.5},
    {"run_id": "src1", "bogus": 1},                  # extra='forbid'
    {"run_id": 123},
])
def test_api_create_schema_422(api, body):
    client, _, tmp = api
    r = client.post("/api/paper-runs", json=body)
    assert r.status_code == 422, r.text
    assert not (tmp / "paper-runs").exists() or list((tmp / "paper-runs").iterdir()) == []


@pytest.mark.parametrize("body, needle", [
    ({"run_id": "missing"}, "not found"),
    ({"run_id": "nosig"}, "signal_engine"),
    ({"run_id": "../runs"}, "run_id"),
    ({"run_id": ".."}, "run_id"),
])
def test_api_create_service_422_with_message(api, body, needle):
    client, _, _ = api
    r = client.post("/api/paper-runs", json=body)
    assert r.status_code == 422
    assert needle in r.json()["detail"]


def test_api_create_boundaries_accepted(api):
    client, _, _ = api
    r = client.post("/api/paper-runs", json={"run_id": "src1", "label": "x" * 80,
                                             "initial_cash": 0.01, "warmup_days": 5000})
    assert r.status_code == 200, r.text
    assert r.json()["label"] == "x" * 80
    r = client.post("/api/paper-runs", json={"run_id": "src1", "label": None,
                                             "initial_cash": None, "warmup_days": 1})
    assert r.status_code == 200 and r.json()["initial_cash"] == 10000.0


def test_api_create_requires_json_body(api):
    client, _, _ = api
    assert client.post("/api/paper-runs").status_code == 422
    assert client.post("/api/paper-runs", content=b"not json",
                       headers={"content-type": "application/json"}).status_code == 422


def test_api_refresh_waiting_and_error_states(api, monkeypatch):
    client, _, _ = api
    pid = client.post("/api/paper-runs", json={"run_id": "src1"}).json()["id"]
    monkeypatch.setattr(svc_mod, "_run_backtest", FakeBacktest(
        response=json.dumps({"status": "error", "error": "nothing would be evaluated"})))
    r = client.post(f"/api/paper-runs/{pid}/refresh")
    assert r.status_code == 200 and r.json()["run"]["state"] == "waiting"
    monkeypatch.setattr(svc_mod, "_run_backtest", FakeBacktest(raises=RuntimeError("kaboom")))
    r = client.post(f"/api/paper-runs/{pid}/refresh")
    assert r.status_code == 200
    assert r.json()["run"]["state"] == "error" and "kaboom" in r.json()["run"]["last_error"]


def test_api_post_without_origin_from_loopback(api):
    _, _, _ = api
    loop = TestClient(app, base_url="http://127.0.0.1:8899", client=("127.0.0.1", 51000),
                      raise_server_exceptions=False)
    r = loop.post("/api/paper-runs", json={"run_id": "src1"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    assert loop.post(f"/api/paper-runs/{pid}/refresh").status_code == 200
    assert loop.post(f"/api/paper-runs/{pid}/stop").status_code == 200
    assert loop.delete(f"/api/paper-runs/{pid}").status_code == 200


def test_api_post_with_loopback_origin(api):
    _, _, _ = api
    loop = TestClient(app, base_url="http://127.0.0.1:8899", client=("127.0.0.1", 51000),
                      headers={"Origin": "http://localhost:5173"}, raise_server_exceptions=False)
    assert loop.post("/api/paper-runs", json={"run_id": "src1"}).status_code == 200


def test_api_responses_are_strict_json(api):
    client, _, _ = api
    pid = client.post("/api/paper-runs", json={"run_id": "src1"}).json()["id"]
    r = client.post(f"/api/paper-runs/{pid}/refresh")
    body = json.loads(r.text)
    assert not any(isinstance(v, float) and not math.isfinite(v)
                   for t in body["trades"] for v in t.values())
