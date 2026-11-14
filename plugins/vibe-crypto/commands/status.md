---
description: Show Vibe Crypto connection, paper run and order-tool status, and how to update
---

Report the current Vibe Crypto status.

1. Call `trading_connections` for the selected profile and `trading_check` for it. Report the result.
2. Call `paper_run_list` and show each run with its status.
3. Say whether `trading_place_order` is available (order tools on or off). If it is off, explain that it is enabled by exporting `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1` before starting Claude Code and restarting it.
4. Show how to update: `uvx --refresh --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --help`, then restart Claude Code.
