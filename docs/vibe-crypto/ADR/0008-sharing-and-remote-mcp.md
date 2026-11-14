# ADR 0008: Sharing with friends, remote MCP and opt-in order tools

Status: accepted
Date: 2026-11-14

(The task brief called this ADR 0007; that number is already used by
`0007-wallet-connect.md`, so this is 0008.)

## Context

Friends want to install Vibe Crypto themselves and trade (paper first, then
their own broker accounts) from Claude Code, Claude Desktop, Cursor and
ChatGPT, the way hosted "trade from ChatGPT" agents do.

What already exists:

- `vibe-crypto-mcp` (FastMCP, 87 tools) with `stdio`, `sse` and `http`
  transports. Network transports bind 127.0.0.1 by default and wrap the app in
  a Host + Origin allow-list (`VIBE_TRADING_MCP_ALLOWED_HOSTS`) against DNS
  rebinding. They have no authentication.
- 19 broker connectors with read, paper and live profiles. Live orders go
  through `src/trading/service.place_order`, which runs the mandate gate,
  kill switch and audit ledger. MCP never exposed `trading_place_order` or
  `trading_cancel_order` (ADR 0003, README "Security model").
- The package installs from a plain checkout. A wheel built from this repo runs
  under `uvx` and serves all 87 tools, 89 skills and the paper-run tools from
  outside the checkout (checked 2026-11-14 with
  `uvx --python 3.12 --from <wheel> vibe-crypto-mcp`).

Constraints: ChatGPT connects only to a remote HTTPS MCP server and its custom
connectors offer "No authentication" or OAuth. Custom headers are not
reliable. Claude Code, Claude Desktop and Cursor run local stdio servers.

## Decision

1. **One install command everywhere:**
   `uvx --python 3.12 --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp`.
   No clone and no virtualenv. uv downloads Python 3.12 if needed. It tracks
   `main`, and `uvx --refresh ...` picks up updates. The first run installs
   about 185 packages, so the guides tell friends to run it once in a terminal
   before adding it to a client.
2. **Claude Code plugin marketplace in this repo.** `.claude-plugin/marketplace.json`
   at the repo root lists one plugin, `plugins/vibe-crypto/`, which holds the
   uvx MCP server, four slash commands (connect a broker, portfolio, paper run,
   status) and a `safe-trading` skill. Install:
   `/plugin marketplace add buckleson/vibe-trading-crypto` and then
   `/plugin install vibe-crypto@vibe-crypto`.
3. **Claude Desktop extension (MCPB).** `extensions/claude-desktop/manifest.json`
   runs the same uvx command. CI packs it with a pinned `@anthropic-ai/mcpb`
   and attaches `vibe-crypto.mcpb` to every GitHub Release that
   `desktop-windows.yml` creates. The desktop version moves to 0.4.0 so a new
   release is published.
4. **Token auth for network transports.** With `VIBE_CRYPTO_MCP_TOKEN` or
   `--token` set, every HTTP request needs either
   `Authorization: Bearer <token>` or the secret path prefix `/<token>/...`
   (for example `https://host/<token>/mcp`, which works for ChatGPT's "No
   authentication" mode). Comparisons are constant time. The token must be at
   least 16 URL-safe characters. Binding a non-loopback host without a token
   is refused at startup. When a token is set and no allowed-hosts list is
   given, the Host/Origin guard allows any host: the token is the access
   control, and tunnel hostnames are random. An explicit `--allowed-hosts` or
   `VIBE_TRADING_MCP_ALLOWED_HOSTS` list is still enforced. uvicorn access logs
   are off while a token is set, so the path token does not reach the logs.
5. **Opt-in order tools.** `--enable-order-tools` or the process environment
   variable `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1` (the `.env` file is not read for
   this switch, the same rule as shell tools) registers `trading_place_order`
   and `trading_cancel_order`. They call the existing registry tools, so paper
   profiles trade broker sandboxes and live profiles still need a mandate, the
   kill switch and the audit ledger. The default stays off, so the default tool
   list is unchanged (87). The in-app chat panel pins the switch to off.
6. **Self-hosting for ChatGPT, one server per person.** The guides cover
   (a) your own PC plus an HTTPS tunnel (cloudflared quick tunnel or ngrok) and
   (b) Google Cloud Run (`deploy/gcp/deploy.sh` and `teardown.sh`): built from
   the repo Dockerfile with `gcloud run deploy --source`, the token stored in
   Secret Manager, a Cloud Storage bucket mounted at `/home/vibe/.vibe-trading`
   for paper runs, settings and broker config, one instance minimum and
   maximum. There is no shared multi-user server. Whoever hosts a server holds
   the broker keys on it, so each friend hosts their own.

## Consequences

- Friends need `uv` installed and nothing else. Updates arrive from `main`.
  A broken `main` breaks every install until it is fixed.
- The README "cannot place live orders" promise becomes "by default". Order
  tools are an explicit, documented opt-in, and the live path is unchanged.
- The path-token form puts the secret in URLs. It stays out of our access
  logs, but Cloud Run's request logs and the tunnel provider can see it. The
  header form is preferred wherever the client supports it.
- Cloud Storage FUSE has no file locking. One instance (`--max-instances 1`)
  avoids concurrent writers. SQLite-backed state may be slow there.
- Backtests on Cloud Run run as the non-root `vibe` user without the
  `vibe-sandbox` UID drop. This needs a check after the first real deploy.

## Alternatives rejected

- **A hosted shared server for all friends.** One process would hold everyone's
  broker keys and need multi-user accounts. Rejected.
- **OAuth for ChatGPT.** It needs an authorization server and user store.
  The path token is enough for a single-user server.
- **Publishing to PyPI.** A git URL works with uvx today and needs no release
  account. It can be revisited.
- **Exposing order tools by default.** Rejected. They stay opt-in.
