# ADR 0004: Paper trading as forward runs of a backtested strategy

Status: accepted
Date: 2026-11-13

## Context

Users need to test strategies on paper: P&L, positions, equity curve, trade
history, and "take this backtested strategy and run it forward on paper".

What exists:

- `agent/src/tools/paper_trade/` (7.8k lines): a daily-bar paper engine with
  saved accounts (`PaperAccounts`, SQLite) for `cn_a`, `hk` and `us` only.
  Manual orders or a strategy file, settled one completed session at a time
  after the local close. No crypto, no intraday, no 24/7 calendar.
  Exposed at `/api/paper-accounts*`, the PaperTrading page, CLI and MCP.
- The backtest engine (`agent/backtest/`): every market including crypto
  (OKX, CCXT, Binance loaders, `engines/crypto.py`), intervals 1m to 1M,
  fees/slippage, writes `artifacts/equity.csv`, `trades.csv`,
  `positions.csv` (weights), `metrics.csv`. It already supports
  `evaluation_start_date`: bars before it are warm-up only, no trade, equity
  point or metric comes from them.
- A backtest run directory (`~/.vibe-trading/runs/<run_id>/`) holds
  `config.json` and `code/signal_engine.py`.

## Decision

Add **paper runs**: a forward-only replay of a backtested strategy.

- Creating a paper run copies `config.json` and `code/signal_engine.py` from a
  source backtest run into `<runtime_root>/paper-runs/<paper_id>/`, records
  `started_at` (UTC now), and sets `evaluation_start_date` to the first bar
  boundary strictly after `started_at` (next UTC day for `1D`/`1W`/`1M`, the
  next interval boundary for intraday).
- **Refresh** rewrites `start_date` (evaluation start minus a warm-up window)
  and `end_date` (today, UTC; frozen at `stopped_at` once stopped) and runs the
  existing `run_backtest()`. Equity, trades, positions and metrics are read
  from the artifacts, which by construction contain only forward bars.
- Before two forward bars exist the engine refuses to evaluate; the run shows
  "waiting for the first bars" instead of an error.
- No background scheduler. The UI refreshes on open, on demand and every
  5 minutes while visible; MCP tools refresh on request.
- The existing manual paper accounts stay as they are, under a second tab.
- `<runtime_root>/paper-runs` is added to the allowed run roots so
  `run_backtest()`'s path guard accepts it, and it stays out of the
  `/runs` listing.

## Consequences

- One engine for backtest and paper: same fills, fees, slippage and market
  rules; works for crypto 24/7 and every other market and interval.
- Results are recomputed from data each refresh. If a vendor revises past bars,
  paper history can shift slightly. Documented in the UI help text.
- A paper run cannot take discretionary orders; manual orders remain available
  for `us`/`hk`/`cn_a` accounts. Manual crypto paper orders are out of scope.
- No new storage engine: one JSON document per run next to its artifacts.

## Alternatives rejected

- **Extend `PaperAccounts` to crypto.** Needs a crypto calendar, rules, data
  path and intraday settlement inside a 7.8k-line engine tuned for exchanges
  with sessions. Large, risky, duplicate of what the backtest engine does.
- **Stateful tick-by-tick simulator with an order book.** New engine, new
  fill model, divergence from backtest results. Rejected (YAGNI).
- **Background scheduler that refreshes runs.** Only matters when nobody is
  looking; refresh-on-read gives the same numbers. Rejected for now.
