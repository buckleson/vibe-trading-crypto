---
description: Read-only overview of balances, positions, open orders and paper runs
argument-hint: [connection id, optional]
---

Give a read-only portfolio overview.

1. Call `trading_connections` to find the selected profile. If `$ARGUMENTS` names a connection, use that one instead.
2. On that connection call `trading_account`, `trading_positions` and `trading_orders`.
3. Call `paper_run_list` for any paper runs.
4. Summarize balances, positions and open orders in a short table, and list paper runs with their status.

This command is read-only. Never place or cancel orders here.
