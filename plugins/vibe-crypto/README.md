# Vibe Crypto plugin for Claude Code

Adds the Vibe Crypto MCP server (87 tools: market data, backtests, paper runs,
19 broker connectors), four slash commands and a `safe-trading` skill.

Commands: `/vibe-crypto:connect-broker`, `/vibe-crypto:portfolio`,
`/vibe-crypto:paper-run`, `/vibe-crypto:status`.

## Install

```
/plugin marketplace add buckleson/vibe-trading-crypto
/plugin install vibe-crypto@vibe-crypto
```

## Prerequisite: uv

macOS / Linux:

```
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Windows (PowerShell):

```
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

## Warm up once

The first start installs about 185 packages and can exceed the MCP startup
timeout. Run this once in a terminal before first use:

```
uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --help
```

## Broker packages

`VIBE_CRYPTO_WITH` is a comma-separated list passed to `uv --with`. Default
`keyring`. Example: `export VIBE_CRYPTO_WITH=keyring,alpaca-py`, then restart
Claude Code. `/vibe-crypto:connect-broker` tells you the package for each broker.

## Order tools

`trading_place_order` and `trading_cancel_order` are off by default. Export
`VIBE_CRYPTO_MCP_ENABLE_ORDERS=1` before starting Claude Code to enable them.
Live profiles still need a mandate and pass the kill switch.

## Update

```
/plugin marketplace update vibe-crypto
uvx --refresh --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --help
```

Then restart Claude Code.

More: [../../guides/share-with-friends.md](../../guides/share-with-friends.md).
This is not financial advice.
