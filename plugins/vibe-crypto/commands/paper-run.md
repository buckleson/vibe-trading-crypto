---
description: Start a paper (simulated) run from a backtest run id or a strategy idea
argument-hint: [backtest run id or strategy idea]
---

Start a paper run for: $ARGUMENTS

- If it looks like a backtest run id, call `paper_run_start` with it. Ask for the starting cash first (default 10000).
- If it is a strategy idea, run a backtest first with the `backtest` tool, or call `list_backtest_runs` and ask which run to use. Then call `paper_run_start`.
- Afterwards call `paper_run_status` and show the result.

Say clearly that paper runs send no real orders.
