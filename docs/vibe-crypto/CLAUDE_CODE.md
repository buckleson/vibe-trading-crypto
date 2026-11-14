# Use Vibe Crypto from Claude Code

## What you get

Claude Code drives Vibe Crypto through its MCP server: research, backtests, forward paper runs, and read-only portfolio and live account views. Claude can start a paper run from a backtest and check how it is doing. Order placement is off by default and opt-in (see Safety).

## Install without cloning (plugin or uvx)

Friends do not need a clone. Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then either use the plugin:

```
/plugin marketplace add buckleson/vibe-trading-crypto
/plugin install vibe-crypto@vibe-crypto
```

or register the server directly:

```
claude mcp add vibe-crypto -- uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp
```

The plugin adds the commands `/vibe-crypto:connect-broker`, `:portfolio`, `:paper-run` and `:status`, and a `safe-trading` skill. Set `VIBE_CRYPTO_WITH` (for example `keyring,alpaca-py`) before starting Claude Code to add broker packages. Full guide: [guides/share-with-friends.md](../../guides/share-with-friends.md).

## Prerequisites

- Install the package from the repo: `pip install -e .` or `uv pip install -e .`. This provides the `vibe-crypto` and `vibe-crypto-mcp` commands.
- Install Claude Code: `npm install -g @anthropic-ai/claude-code`.

## Set up with one command

```
claude mcp add vibe-crypto -- vibe-crypto-mcp
```

Alternative: `vibe-crypto mcp install`. It registers the server with absolute paths, so it works without an activated virtualenv. Options: `--scope local|user|project` (default `user`) and `--dry-run` to print the command only.

To load the server for a single session, run `vibe-crypto mcp config > vibe.json` and start `claude --mcp-config vibe.json`.

## Project config

The repo root has a `.mcp.json` that registers `vibe-crypto` through `vibe-crypto-mcp`. It works when the virtualenv is active or the package is installed globally. Claude Code asks you to approve project servers the first time.

## Check it works

- `claude mcp list` should show `vibe-crypto` as Connected. Run it from outside the repo if you also registered the server at user scope.
- Inside `claude`, type `/mcp`.
- Try these prompts:
  - List my latest backtest runs
  - Start a paper run from run <id> with 10000 starting cash
  - How is paper run <id> doing? Refresh it first.
  - Backtest a 20/50 moving average cross on BTC-USDT 4H for 2025

## Tools

- Paper runs: `paper_run_list`, `paper_run_start`, `paper_run_status`, `paper_run_stop`. Also `paper_trade_step` and `paper_trade_reconcile` for ledger-level paper steps.
- Backtests and runs: `run_backtest`, `list_backtest_runs`, run inspection and metrics tools.
- Research goals and skills: goal, hypothesis, playbook and skill lookup tools.
- Market data: price, OHLCV, fundamentals and news tools across stocks, crypto and other markets.
- Portfolio and trading, read-only: portfolio and connector account views (balances, positions, orders).
- Swarm: multi-agent research teams, with run listing and status.

Ask Claude "what Vibe Crypto tools do you have?" for the full list.

## HTTP transport

```
vibe-crypto-mcp --transport http --port 8900
claude mcp add --transport http vibe-crypto http://127.0.0.1:8900/mcp
```

The server binds to 127.0.0.1 by default and rejects foreign Host and Origin headers. To serve it beyond this computer, set `VIBE_CRYPTO_MCP_TOKEN` (or `--token`). Clients then send `Authorization: Bearer <token>` or use `https://<host>/<token>/mcp`. A non-loopback `--host` without a token is refused, and `--allowed-hosts` (or `VIBE_TRADING_MCP_ALLOWED_HOSTS`) sets the allowed Host names. See [guides/mcp.md](../../guides/mcp.md) and [guides/share-with-friends.md](../../guides/share-with-friends.md).

## Safety

- Order placement is off by default. `trading_place_order` and `trading_cancel_order` exist only when you start the server with `--enable-order-tools` or set `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1` in the process environment.
- Live orders still need a mandate you approve and pass the kill switch, even with the order tools on.
- Shell tools (`bash`, `background_run`) are off unless you start the server with `--enable-shell-tools` or set `VIBE_TRADING_ENABLE_SHELL_TOOLS=1`.
- Paper runs place no real orders.

## Inside the app

The desktop app has a chat panel and a terminal panel. Both use this same MCP server, so what works here works there.

## Troubleshooting

- Command not found: the virtualenv is not active. Use `vibe-crypto mcp install`, which stores absolute paths.
- Already exists: run `claude mcp remove vibe-crypto`, then install again.
- The first call is slow because the tool registry loads on first use.
- Settings and API keys are read from `~/.vibe-trading/.env` or `agent/.env`.
