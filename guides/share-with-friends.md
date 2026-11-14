# Share Vibe Crypto with friends

Vibe Crypto gives Claude or ChatGPT research tools, backtests, paper trading and, if you choose, your own broker accounts. This guide shows how a friend installs their own copy in Claude Code, Claude Desktop, Cursor or ChatGPT.

## Safety first

- **Everyone installs or hosts their own copy.** Do not share a server, a URL or a token. A running server holds that person's broker keys. There is no shared multi-user server ([ADR 0008](../docs/vibe-crypto/ADR/0008-sharing-and-remote-mcp.md)).
- **Keys never go into a chat.** Broker keys are entered in your own terminal (hidden prompt) or stored in files on your own machine or bucket.
- **Paper first.** Backtests and paper runs place no real orders. Try your broker's paper profile before anything else.
- **Order tools are off by default.** Claude and ChatGPT cannot place or cancel orders unless you turn the order tools on. Live orders also need a mandate you approve and pass the kill switch.
- This is software for research and learning, not financial advice. You are responsible for every trade.

## Pick your app

| App | How it connects | Section |
|---|---|---|
| Claude Code | Plugin from this repo (runs locally with uvx) | [Claude Code](#claude-code) |
| Claude Desktop | One-click `.mcpb` extension, or manual JSON | [Claude Desktop](#claude-desktop) |
| Cursor | `~/.cursor/mcp.json` entry (runs locally) | [Cursor](#cursor) |
| Other stdio MCP clients | The uvx command below | [Step 0](#step-0-install-uv-and-warm-it-up) |
| ChatGPT | Remote HTTPS server: your PC plus a tunnel, or Google Cloud Run | [Option A](#chatgpt-option-a-your-own-computer-plus-an-https-tunnel), [Option B](#chatgpt-option-b-google-cloud-run) |

All the local options run the same command, with no clone and no virtualenv:

```bash
uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp
```

## Step 0: install uv and warm it up

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/):
   - macOS or Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
   - Windows (PowerShell): `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
2. Install [git](https://git-scm.com/downloads) (uv uses it to fetch the code from GitHub). The Claude Desktop extension downloads a zip instead, so it does not need git.
3. Open a new terminal and run the command once so uv downloads Python 3.12 and the packages (about 185 packages):

   ```bash
   uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --help
   ```

   It took about 16 seconds on a cold cache in testing and a few seconds afterwards. A slow connection takes longer. Do this before adding the server to an app, so the app does not time out on its first start.

Each start asks GitHub for the latest commit and reuses the cached install when nothing changed, so you need internet access to GitHub even when the cache is warm.

## Claude Code

Install the plugin from this repo:

```
/plugin marketplace add buckleson/vibe-trading-crypto
/plugin install vibe-crypto@vibe-crypto
```

Restart Claude Code if asked. You get the MCP server (87 tools), four slash commands and a skill:

| Command | What it does |
|---|---|
| `/vibe-crypto:connect-broker` | Walks you through connecting a broker without pasting secrets into chat |
| `/vibe-crypto:portfolio` | Read-only overview of balances, positions, open orders and paper runs |
| `/vibe-crypto:paper-run` | Starts or checks a paper run from a backtest |
| `/vibe-crypto:status` | Shows the connection check, paper runs, whether order tools are on, and how to update |

The `safe-trading` skill tells Claude to work paper first and to ask you before any live order.

To install extra broker packages, set `VIBE_CRYPTO_WITH` in the environment Claude Code starts from, then restart it:

```bash
export VIBE_CRYPTO_WITH=keyring,alpaca-py
```

Without a plugin, one command does the same job:

```bash
claude mcp add vibe-crypto -- uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp
```

## Claude Desktop

**Extension (easiest).** Download the extension and open it with Claude Desktop (Settings > Extensions, or double-click the file):

<https://github.com/buckleson/vibe-trading-crypto/releases/latest/download/vibe-crypto-claude-desktop.mcpb>

Install uv first (Step 0). The extension settings let you add Python packages (keep `keyring` in the list) and turn the order tools on. The file is attached to each GitHub release; if the link does not work yet, no release has published it, so use the manual setup below.

**Manual setup.** Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vibe-crypto": {
      "command": "uvx",
      "args": [
        "--python", "3.12",
        "--with", "keyring",
        "--from", "git+https://github.com/buckleson/vibe-trading-crypto",
        "vibe-crypto-mcp"
      ],
      "env": { "VIBE_CRYPTO_MCP_ENABLE_ORDERS": "0" }
    }
  }
}
```

The `env` block is optional; `1` turns on the order tools. Quit and reopen Claude Desktop afterwards. If the app cannot find `uvx`, put the full path to it in `command` (`which uvx` on macOS or Linux, `where uvx` on Windows).

## Cursor

Add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "vibe-crypto": {
      "command": "uvx",
      "args": [
        "--python", "3.12",
        "--with", "keyring",
        "--from", "git+https://github.com/buckleson/vibe-trading-crypto",
        "vibe-crypto-mcp"
      ]
    }
  }
}
```

## Connect a broker

Connecting a broker is done in your own terminal, never in chat. Pick the profile id from `trading_connections` (for example `alpaca-paper-trade`, `alpaca-live-trade` or `alpaca-live-sdk-readonly`) and run:

```bash
uvx --python 3.12 --with keyring,alpaca-py --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto connector setup alpaca-paper-trade --connection-id my-alpaca
```

It asks for the keys with a hidden prompt and stores them in your OS keychain. Replace `alpaca-py` with the package from the table. The server needs the same package:

- Claude Code plugin: set `VIBE_CRYPTO_WITH` (for example `keyring,alpaca-py`) before starting it.
- Claude Desktop extension: fill in "Python packages".
- Manual configs: add the package to the `--with` value.

Then restart the app and ask Claude to run `trading_check` on the connection. The keychain is on your computer, so this works for local installs. For a Cloud Run server see [deploy/gcp/README.md](../deploy/gcp/README.md#broker-keys-on-cloud-run).

All 19 connectors. The columns come from the generated matrix in [portfolio-and-brokers.md](portfolio-and-brokers.md#full-broker-permissions) (profiles `*-readonly`, `*-paper-trade`, `*-live-trade`) and the `dependency` field in `agent/src/trading/onboarding.py`. "Paper" means the broker's own sandbox or a simulation through a `*-paper-trade` profile. "Live" means orders under a mandate.

| Broker | Market or region | Read | Paper | Live (mandate) | Python package |
|---|---|---|---|---|---|
| alpaca | US stocks, crypto | Yes | Yes | Yes | `alpaca-py` |
| robinhood | US stocks, crypto | Yes | No | Yes | none (OAuth through a remote connector) |
| ibkr | Global | Yes | No | No | `ib_async` |
| etoro | Multi-asset, copy trading | Yes | Yes | Yes | `requests` (already installed) |
| zerodha | India | Yes | Yes | No | `kiteconnect` |
| dhan | India | Yes | Yes | No | `dhanhq` |
| shoonya | India | Yes | Yes | No | `NorenRestApiPy` (and `pyotp`) |
| mstock | India | Yes | No | No | `httpx` (already installed) |
| futu | Hong Kong, US, China A-shares | Yes | Yes | Yes | `futu-api` |
| tiger | US, Hong Kong, Singapore | Yes | Yes | Yes | `tigeropen` |
| longbridge | Hong Kong, US | Yes | Yes | No | `longbridge` |
| kis | Korea | Yes | Yes | No | `requests` (already installed) |
| toss | Korea | Yes | No | No | `requests` (already installed) |
| upbit | Korea, KRW crypto | Yes | Yes | No | `PyJWT` |
| trading212 | UK and Europe | Yes | No | No | `requests` (already installed) |
| scalable | Europe | Yes | No | No | none (OAuth through a remote connector) |
| binance | Crypto | Yes | Yes | Yes | `ccxt` |
| okx | Crypto | Yes | Yes | Yes | `python-okx` |
| mt5 | Forex and CFDs | Yes | Yes | Yes | `MetaTrader5` (Windows only) |

Notes:

- IBKR needs TWS or IB Gateway running on the same computer, with its local API socket enabled. Its paper profile is read-only here.
- MetaTrader 5 only runs on Windows, next to a MetaTrader 5 terminal.
- Futu needs its OpenD gateway running locally.
- Robinhood and Scalable connect through OAuth with a remote connector, so there is no keychain step.
- A dash in the matrix means "no such profile". Some brokers (Trading 212, Toss, Scalable, mStock) refuse order placement entirely.

## Trading

- **Paper runs** need no broker. Ask Claude to backtest a strategy, then to start a paper run (`paper_run_start`). No orders go anywhere; results update when you check the run.
- **Broker paper profiles** (`<broker>-paper-trade`) send orders to the broker's sandbox where it has one. They need the order tools (next point) because they place orders.
- **Turn on the order tools** only when you want Claude to place or cancel orders. Set `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1` in the process environment (Claude Desktop `env` block, the extension toggle, `export` for Claude Code) or pass `--enable-order-tools`. It adds `trading_place_order` and `trading_cancel_order`. A `.env` file does not turn it on. Claude should ask you before each order.
- **Live orders** need more than the order tools. The connection must use a `*-live-trade` profile and a mandate: a limit set (symbol allowlist, order size and exposure caps, daily trade cap, expiry) that you approve yourself. In the interactive `vibe-crypto` terminal chat the agent proposes mandates as a numbered list and you pick one; the app commits it through its own surface, not through an agent tool ([capabilities guide](capabilities.md), [mandate routes](../agent/src/api/live_routes.py)). Every live order passes the mandate gate and the audit ledger.
- **Kill switch.** `/halt` in the terminal chat stops all live trading at once and `/resume` clears it (see [CLI and API](cli-and-api.md)). `vibe-crypto connector halt` and `vibe-crypto connector resume` do the same for a remote connector profile.

## ChatGPT option A: your own computer plus an HTTPS tunnel

ChatGPT connects only to remote HTTPS servers, so your PC runs the server and a tunnel gives it a public HTTPS address. The PC must stay on and awake while you use it.

1. Make a token (16 to 256 characters of letters, digits, `_` and `-`):

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. Start the server with the token. macOS or Linux:

   ```bash
   VIBE_CRYPTO_MCP_TOKEN=<token> uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --transport http --port 8900
   ```

   Windows PowerShell:

   ```powershell
   $env:VIBE_CRYPTO_MCP_TOKEN = "<token>"
   uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --transport http --port 8900
   ```

   It listens on `127.0.0.1:8900`. Use the environment variable, not `--token`: command-line arguments are visible to other users of the computer.

3. In a second terminal start a tunnel:
   - Cloudflare quick tunnel: `cloudflared tunnel --url http://127.0.0.1:8900`. It prints a `https://<random>.trycloudflare.com` address. You get a new random address on every start.
   - ngrok: `ngrok http 8900`. A free static domain is possible, so the address can stay the same.

4. In ChatGPT on the web, open Settings > Apps & Connectors > Advanced settings and turn on Developer mode. Then create a connector:
   - Name: Vibe Crypto
   - MCP server URL: `https://<tunnel-host>/<token>/mcp`
   - Authentication: **No authentication** (the token is in the URL path)
   - Tick the box saying you trust this server.

5. In a chat, pick the connector from the "+" menu or the Developer mode menu, and ask for a backtest or a paper run.

Menu names change and the feature depends on your ChatGPT plan, so look for "connectors", "apps" or "developer mode" if the names differ. ChatGPT asks before it runs write actions. Anyone who has the tunnel URL with the token can use your server, so keep it private and stop the tunnel when you are done.

The same server works with Claude Code over the tunnel, with the header form:

```bash
claude mcp add --transport http vibe-crypto https://<tunnel-host>/mcp --header "Authorization: Bearer <token>"
```

A server listening on a non-loopback address (`--host 0.0.0.0`) refuses to start without a token. A token also turns off the access log, so the path token is not written to the server's log. If you use your own domain, set `--allowed-hosts` (or `VIBE_TRADING_MCP_ALLOWED_HOSTS`) to it; with a token and no list, any host is accepted.

## ChatGPT option B: Google Cloud Run

Run your own always-on server in your own Google Cloud project, so your PC can be off. One script deploys it:

```bash
git clone https://github.com/buckleson/vibe-trading-crypto && cd vibe-trading-crypto
deploy/gcp/deploy.sh --project my-project --dry-run    # shows every command first
deploy/gcp/deploy.sh --project my-project
```

It stores a random token in Secret Manager, keeps data in a Cloud Storage bucket, runs one always-on instance (it bills while idle) and prints your ChatGPT URL `https://<service-url>/<token>/mcp`. Add it in ChatGPT as in step 4 above. `deploy/gcp/teardown.sh` removes it. Costs, broker keys on Cloud Run, token rotation and limits are in [deploy/gcp/README.md](../deploy/gcp/README.md). The deploy path has not been run against a real project yet.

A hosted server holds your broker keys. Use paper or read-only keys while you test, and never share the URL or the token.

## Sharing safely

- Send a friend the link to this guide, not your server, your URL or your token.
- Never paste a token, a tunnel URL with a token or a broker key into a chat, an issue or a screenshot.
- Each person runs their own copy. Do not set up one server for several people: it would mix their accounts and keys.
- Keep order tools off until you have run paper trading for a while. Keep live mandates small and short.
- If a token leaks, stop the server or tunnel, make a new token and update the connector. For Cloud Run see token rotation in [deploy/gcp/README.md](../deploy/gcp/README.md#rotate-the-token).

## Update and uninstall

- Update the uvx install: `uvx --refresh --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --help`, then restart the app. An app that stays open keeps running the old server until restarted. The install tracks the `main` branch of the repo.
- Claude Code plugin: `/plugin marketplace update vibe-crypto`, and `/plugin uninstall vibe-crypto@vibe-crypto` to remove it.
- Claude Desktop extension: Settings > Extensions, then remove Vibe Crypto. For manual setup delete the entry from `claude_desktop_config.json`.
- Free disk space: `uv cache clean`.
- Your data stays in `~/.vibe-trading` until you delete that folder. Broker keys are in your OS keychain; remove them there.

## Troubleshooting

- **`uvx: command not found`.** Install uv (Step 0) and open a new terminal. In Claude Desktop use the full path to `uvx` in `command`.
- **The first start is slow or the app times out.** Run the warm-up command from Step 0 in a terminal first, then restart the app.
- **401 from the remote server.** The token is wrong or missing. Check the URL has `/<token>/mcp` exactly, or that the header is `Authorization: Bearer <token>`. After a token rotation, update the connector.
- **400 "Invalid host header".** The server only accepts localhost names without a token. Start it with a token (any host is then accepted) or set `--allowed-hosts your.domain`.
- **"Refusing to listen on 0.0.0.0 without a token".** Set `VIBE_CRYPTO_MCP_TOKEN` (or `--token`). This is on purpose: a network server without a token would be open to everyone.
- **A broker tool says its package is missing.** Add the package from the broker table with `--with` (or `VIBE_CRYPTO_WITH`, or the extension setting) and restart the app.
- **The order tools are not there.** They are off by default. See Trading above.
