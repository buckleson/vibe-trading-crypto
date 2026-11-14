"""Paper runs: run a backtested strategy forward from now, reusing the engine."""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from src.config.paths import get_runs_dir, get_runtime_root

WARMUP_DAYS = {
    "1m": 7, "5m": 14, "15m": 30, "30m": 45, "1H": 90,
    "4H": 180, "1D": 400, "1W": 1500, "1M": 3000,
}
INTERVAL_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1H": 60, "4H": 240}

_SOURCE_ID = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
_PAPER_ID = re.compile(r"^[0-9a-f]{12}$")
_WAITING_MARKERS = (
    "nothing would be evaluated",
    "evaluation window would hold",
    "No data fetched",
    "after the last loaded bar",
)

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


class PaperRunNotFound(KeyError):
    """Raised when a paper run id does not exist."""


def _run_backtest(run_dir: str) -> str:
    """Patch point: lazily call the real backtest tool."""
    from src.tools.backtest_tool import run_backtest

    return run_backtest(run_dir)


def _lock_for(paper_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(paper_id, threading.Lock())


def forward_start(started_at: datetime, interval: str) -> str:
    """First bar boundary strictly after ``started_at`` (UTC)."""
    t = started_at.astimezone(timezone.utc) if started_at.tzinfo else started_at.replace(tzinfo=timezone.utc)
    minutes = INTERVAL_MINUTES.get(interval)
    if minutes is None:
        return (t.date() + timedelta(days=1)).isoformat()
    midnight = t.replace(hour=0, minute=0, second=0, microsecond=0)
    elapsed = int((t - midnight).total_seconds())
    step = minutes * 60
    nxt = midnight + timedelta(seconds=(elapsed // step + 1) * step)
    return nxt.strftime("%Y-%m-%dT%H:%M:%S")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _num(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _read_csv(path: Path, **kw) -> pd.DataFrame | None:
    if not path.is_file():
        return None
    try:
        return pd.read_csv(path, **kw)
    except Exception:
        return None


class PaperRuns:
    def __init__(
        self,
        root: Path | None = None,
        *,
        clock: Callable[[], datetime] | None = None,
        backtest: Callable[[str], str] | None = None,
        runs_dir: Path | None = None,
    ) -> None:
        self.root = Path(root) if root is not None else get_runtime_root() / "paper-runs"
        self.runs_dir = Path(runs_dir) if runs_dir is not None else get_runs_dir()
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._backtest = backtest

    # -- helpers
    def _dir(self, paper_id: str) -> Path:
        if not isinstance(paper_id, str) or not _PAPER_ID.match(paper_id):
            raise PaperRunNotFound(paper_id)
        return self.root / paper_id

    def _now(self) -> datetime:
        return self._clock().astimezone(timezone.utc)

    def _save(self, doc: dict) -> None:
        _write_json(self.root / doc["id"] / "paper_run.json", doc)

    # -- create
    def create(self, *, run_id: str, label: str | None = None,
               initial_cash: float | None = None, warmup_days: int | None = None) -> dict:
        if not isinstance(run_id, str) or not _SOURCE_ID.match(run_id) or run_id in {".", ".."}:
            raise ValueError("run_id must be 1-200 characters of letters, digits, '.', '_' or '-'")
        src = self.runs_dir / run_id
        cfg_path = src / "config.json"
        sig_path = src / "code" / "signal_engine.py"
        if not cfg_path.is_file():
            raise ValueError(f"Backtest run '{run_id}' not found (missing config.json)")
        if not sig_path.is_file():
            raise ValueError(f"Backtest run '{run_id}' has no code/signal_engine.py")
        try:
            config = json.loads(cfg_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"config.json of '{run_id}' is not valid JSON: {exc}") from exc
        codes = config.get("codes")
        if not isinstance(codes, list) or not codes or not all(isinstance(c, str) for c in codes):
            raise ValueError("Source config must have a non-empty 'codes' list")
        interval = config.get("interval", "1D")
        if interval not in WARMUP_DAYS:
            raise ValueError(f"Unsupported interval '{interval}'; use one of {', '.join(WARMUP_DAYS)}")
        cash = initial_cash if initial_cash is not None else config.get("initial_cash", 100000.0)
        cash = _num(cash)
        if cash is None or cash <= 0:
            raise ValueError("initial_cash must be a positive number")
        days = warmup_days if warmup_days is not None else WARMUP_DAYS[interval]
        if days < 1:
            raise ValueError("warmup_days must be at least 1")

        started = self._now()
        paper_id = uuid.uuid4().hex[:12]
        doc = {
            "id": paper_id,
            "label": (label or f"{', '.join(codes[:3])} paper")[:80],
            "source_run_id": run_id,
            "codes": codes,
            "source": config.get("source", "auto"),
            "interval": interval,
            "initial_cash": cash,
            "started_at": started.isoformat(),
            "evaluation_start": forward_start(started, interval),
            "warmup_start": (started.date() - timedelta(days=days)).isoformat(),
            "status": "active",
            "stopped_at": None,
            "last_refreshed_at": None,
            "state": "waiting",
            "last_error": None,
            "summary": None,
        }
        dest = self.root / paper_id
        (dest / "code").mkdir(parents=True, exist_ok=True)
        for py in (src / "code").glob("*.py"):
            shutil.copy2(py, dest / "code" / py.name)
        _write_json(dest / "source_config.json", config)
        self._save(doc)
        return doc

    # -- read
    def list(self) -> list[dict]:
        docs = []
        if self.root.is_dir():
            for child in self.root.iterdir():
                f = child / "paper_run.json"
                if _PAPER_ID.match(child.name) and f.is_file():
                    try:
                        docs.append(json.loads(f.read_text(encoding="utf-8")))
                    except (OSError, json.JSONDecodeError):
                        continue
        return sorted(docs, key=lambda d: d.get("started_at", ""), reverse=True)

    def get(self, paper_id: str) -> dict:
        f = self._dir(paper_id) / "paper_run.json"
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PaperRunNotFound(paper_id) from exc

    def detail(self, paper_id: str) -> dict:
        doc = self.get(paper_id)
        art = self._dir(paper_id) / "artifacts"
        equity: list[dict] = []
        eq = _read_csv(art / "equity.csv")
        if eq is not None and "equity" in eq.columns:
            tcol = "timestamp" if "timestamp" in eq.columns else eq.columns[0]
            for _, r in eq.iterrows():
                equity.append({
                    "time": str(r[tcol]),
                    "equity": _num(r["equity"]),
                    "drawdown": _num(r["drawdown"]) if "drawdown" in eq.columns else None,
                })
        trades: list[dict] = []
        tr = _read_csv(art / "trades.csv")
        if tr is not None:
            def cell(r, name):
                if name not in tr.columns or pd.isna(r[name]):
                    return None
                return r[name]
            for _, r in tr.iterrows():
                trades.append({
                    "time": str(cell(r, "timestamp")) if cell(r, "timestamp") is not None else None,
                    "symbol": cell(r, "code"),
                    "side": cell(r, "side"),
                    "price": _num(cell(r, "price")),
                    "qty": _num(cell(r, "qty")),
                    "pnl": _num(cell(r, "pnl")),
                    "return_pct": _num(cell(r, "return_pct")),
                    "event": cell(r, "event"),
                    "reason": cell(r, "reason"),
                })
            trades.reverse()
        positions: list[dict] = []
        po = _read_csv(art / "positions.csv")
        if po is not None and len(po):
            last = po.iloc[-1]
            for col in po.columns[1:]:
                w = _num(last[col])
                if w is not None and abs(w) > 1e-9:
                    positions.append({"symbol": col, "weight": w})
        return {"run": doc, "equity": equity, "trades": trades, "positions": positions}

    # -- mutate
    def refresh(self, paper_id: str) -> dict:
        with _lock_for(paper_id):
            doc = self.get(paper_id)
            run_dir = self._dir(paper_id)
            now = self._now()
            if doc["status"] == "stopped" and doc.get("stopped_at"):
                end = datetime.fromisoformat(doc["stopped_at"]).astimezone(timezone.utc).date()
            else:
                end = now.date()
            config = json.loads((run_dir / "source_config.json").read_text(encoding="utf-8"))
            config.pop("warmup_bars", None)
            config.pop("frozen_data_manifest", None)
            config.update(
                start_date=doc["warmup_start"],
                end_date=end.isoformat(),
                evaluation_start_date=doc["evaluation_start"],
                initial_cash=doc["initial_cash"],
            )
            _write_json(run_dir / "config.json", config)
            shutil.rmtree(run_dir / "artifacts", ignore_errors=True)

            backtest = self._backtest or _run_backtest
            doc["summary"] = None
            try:
                raw = backtest(str(run_dir))
                try:
                    env = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    env = {"status": "error", "error": str(raw)}
                if not isinstance(env, dict):
                    env = {"status": "error", "error": str(raw)}
            except Exception as exc:  # noqa: BLE001
                env = {"status": "error", "error": f"{type(exc).__name__}: {exc}"}

            if env.get("status") == "ok":
                doc["state"], doc["last_error"] = "ok", None
                doc["summary"] = self._summary(run_dir, doc["initial_cash"])
            else:
                text = json.dumps(env, ensure_ascii=False)
                if any(m in text for m in _WAITING_MARKERS):
                    doc["state"], doc["last_error"] = "waiting", None
                else:
                    msg = env.get("error") or env.get("stderr") or text
                    doc["state"], doc["last_error"] = "error", str(msg)[:500]
            doc["last_refreshed_at"] = now.isoformat()
            self._save(doc)
        return self.detail(paper_id)

    def _summary(self, run_dir: Path, cash: float) -> dict | None:
        art = run_dir / "artifacts"
        eq = _read_csv(art / "equity.csv")
        if eq is None or eq.empty or "equity" not in eq.columns:
            return None
        last = float(eq["equity"].iloc[-1])
        tcol = "timestamp" if "timestamp" in eq.columns else eq.columns[0]
        dd = _num(eq["drawdown"].min()) if "drawdown" in eq.columns else None
        sharpe = None
        m = _read_csv(art / "metrics.csv")
        if m is not None and len(m):
            for col in m.columns:
                if "sharpe" in col.lower():
                    sharpe = _num(m[col].iloc[0])
                    break
        tr = _read_csv(art / "trades.csv")
        return {
            "equity": last,
            "pnl": last - cash,
            "total_return": last / cash - 1,
            "max_drawdown": dd,
            "sharpe": sharpe,
            "trade_count": 0 if tr is None else len(tr),
            "bars": len(eq),
            "as_of": str(eq[tcol].iloc[-1]),
        }

    def stop(self, paper_id: str) -> dict:
        with _lock_for(paper_id):
            doc = self.get(paper_id)
            if doc["status"] != "stopped":
                doc["status"] = "stopped"
                doc["stopped_at"] = self._now().isoformat()
                self._save(doc)
        return self.detail(paper_id)

    def delete(self, paper_id: str) -> None:
        d = self._dir(paper_id)
        with _lock_for(paper_id):
            if not d.is_dir():
                raise PaperRunNotFound(paper_id)
            shutil.rmtree(d)
