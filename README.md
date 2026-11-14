# Vibe Crypto

Vibe Crypto is a local app for AI-assisted research, backtesting and paper trading of crypto, stocks and other markets. Claude is built in: chat with it inside the app, drive the app from Claude Code, or use an embedded terminal in the desktop app.

Everything runs on your computer. There is no account and no login.

## What you can do

- Research with an AI agent and with Claude, using market data, filings, news, factors and saved research artifacts.
- Backtest across crypto (OKX, CCXT, Binance), US, HK and China equities, futures, forex and options, at intervals from 1 minute to 1 month.
- Paper trade strategies forward on live data, with P&L, positions, an equity curve and trade history.
- View portfolios and broker accounts read-only through the existing live connectors.
- See your MetaMask wallet address, network and balance (read-only, browser only).
- Run it as a desktop app on Windows, macOS and Linux, or as a local web app.

## Quick start

You need Python 3.11 or newer and Node 22 or newer.

```bash
git clone https://github.com/buckleson/vibe-trading-crypto
cd vibe-trading-crypto
python -m venv .venv
. .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e .
vibe-crypto init              # creates ~/.vibe-trading/.env and asks for an LLM provider
vibe-crypto setup             # installs frontend dependencies and builds the web UI
vibe-crypto serve             # then open http://127.0.0.1:8899
```

`vibe-crypto serve` listens on port 8899 by default. Add `--port` to change it.

For frontend development, run the API in one terminal and the dev server in another:

```bash
vibe-crypto serve
cd frontend && npm install && npm run dev     # http://localhost:5899, proxies the API
```

Docker is also supported. See [guides/installation.md](guides/installation.md).

## Desktop app

The Electron app starts and owns a local backend, picks a free loopback port and opens the UI in a window. It runs from source on Windows, macOS and Linux:

```bash
pip install -e .              # once, from the repository root
cd desktop/electron
npm install
npm start
```

Windows packages bundle their own Python runtime. macOS and Linux builds use the `vibe-crypto` command from your PATH, the repo `.venv`, or `VIBE_TRADING_EXECUTABLE`. The terminal tab needs the native `node-pty` module, which may need `npm run rebuild:native` on Linux. Packaging commands, unsigned macOS builds and troubleshooting are in [desktop/electron/README.md](desktop/electron/README.md).

## Use with Claude

There are three ways. All three reach the app through the same MCP server, so a tool added there is available everywhere.

1. **Chat panel.** Open the panel with Ctrl+J (Cmd+J on macOS). It uses the Claude Agent SDK and needs either `ANTHROPIC_API_KEY` or a logged-in Claude Code. Claude can run backtests, start paper runs and read your portfolio. Settings shows whether Claude is available.
2. **Claude Code CLI.** Register the MCP server once:

   ```bash
   claude mcp add vibe-crypto -- vibe-crypto-mcp
   ```

   `vibe-crypto mcp install` does the same with absolute paths, so no active virtualenv is needed. `vibe-crypto mcp config` prints JSON for `claude --mcp-config`. Details: [docs/vibe-crypto/CLAUDE_CODE.md](docs/vibe-crypto/CLAUDE_CODE.md).
3. **Desktop terminal.** In the desktop app, the Terminal tab of the assistant panel runs your local `claude` CLI with the MCP server already wired. Install the CLI with `npm install -g @anthropic-ai/claude-code` if it is missing.

Claude can research, backtest and paper trade. By default Claude cannot place live orders; see Share with friends for the opt-in order tools.

## Share with friends

- Claude Code: `/plugin marketplace add buckleson/vibe-trading-crypto`, then `/plugin install vibe-crypto@vibe-crypto`. It adds `/vibe-crypto:connect-broker`, `:portfolio`, `:paper-run` and `:status`.
- Claude Desktop: install the [Vibe Crypto extension](https://github.com/buckleson/vibe-trading-crypto/releases/latest/download/vibe-crypto-claude-desktop.mcpb).
- Any stdio client, no clone: `uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp`.
- ChatGPT: host your own server through an HTTPS tunnel or on Google Cloud Run, protected by `VIBE_CRYPTO_MCP_TOKEN`.
- One copy per person: a server holds that person's broker keys, so nobody shares one.
- Setup for every app, the broker list and the safety rules: [guides/share-with-friends.md](guides/share-with-friends.md).

## Paper trading

- Backtest a strategy, open the run and choose "Run on paper".
- The app copies the strategy and records the start time. Only bars after that moment count.
- Each refresh recomputes the run with the same engine as the backtest, so fills, fees and slippage match. Refresh happens when you open the run, on demand and every 5 minutes while the page is visible. There is no background scheduler.
- The run page shows P&L, positions, the equity curve and trade history. You can stop or delete a run. Crypto runs use the 24/7 calendar.
- Manual paper accounts for US, HK and China A-share markets are on the second tab. You place orders by hand or load a strategy file, and they settle after each session.
- No orders are ever sent to a broker or exchange.

## Broker connectors

Live connectors are read-only by default for portfolio and account views. Placing live orders is gated by per-connection limits, a kill switch and an audit ledger, and is off for Claude and MCP unless you opt in to the order tools. See [guides/portfolio-and-brokers.md](guides/portfolio-and-brokers.md).

<!-- BEGIN GENERATED broker-capability-matrix -->

### Broker support at a glance

<details>
<summary>Compare read-only, paper and live support by broker</summary>

**Read** means a dedicated read-only profile. **Sim** means paper orders through a broker sandbox or local simulation. **Live** means live orders under a mandate.

Yes indicates a declared capability. A dash means no matching profile is declared.

| Broker | Read | Sim | Live |
| --- | :---: | :---: | :---: |
| alpaca | Yes | Yes | Yes |
| binance | Yes | Yes | Yes |
| dhan | Yes | Yes | — |
| etoro | Yes | Yes | Yes |
| futu | Yes | Yes | Yes |
| ibkr | Yes | — | — |
| kis | Yes | Yes | — |
| longbridge | Yes | Yes | — |
| mstock | Yes | — | — |
| mt5 | Yes | Yes | Yes |
| okx | Yes | Yes | Yes |
| robinhood | Yes | — | Yes |
| scalable | Yes | — | — |
| shoonya | Yes | Yes | — |
| tiger | Yes | Yes | Yes |
| toss | Yes | — | — |
| trading212 | Yes | — | — |
| upbit | Yes | Yes | — |
| zerodha | Yes | Yes | — |

</details>

[Full permissions by profile](guides/portfolio-and-brokers.md#full-broker-permissions)

<!-- END GENERATED broker-capability-matrix -->

## Configuration

- Settings are read from `~/.vibe-trading/.env` and `agent/.env`. `vibe-crypto init` creates the first one. [agent/.env.example](agent/.env.example) lists every option.
- LLM providers include OpenRouter, OpenAI, Anthropic, DeepSeek, Ollama, Claude Code (`claude-cli`) and more. Pick one in Settings or in the env file.
- Data source keys (for example Tushare) go in the same files or in Settings. Public crypto market data needs no key.
- Broker and exchange credentials are stored on this computer only. Install the `keyring` extra (`pip install -e ".[keyring]"`) to use the OS keychain.
- Runtime data lives in `~/.vibe-trading/` (runs, sessions, paper accounts, paper runs). Set `VIBE_TRADING_HOME` to move it.
- The `VIBE_TRADING_*` variable names and the `~/.vibe-trading` folder keep their old names for compatibility.

## Security model

- Vibe Crypto is a local, single-user app. There is no login or API key for the app. The only secret is the optional MCP server token below.
- The API accepts requests only from this computer. Requests from other machines get a 403.
- Cross-site browser requests and foreign Host headers are blocked, so a website you visit cannot drive the local API.
- Live order placement is off for Claude and the MCP server by default. The opt-in order tools (`--enable-order-tools` or `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1`) still go through the mandate and the kill switch, and live connectors keep their own limits and confirmations.
- The network MCP transports (`http` and `sse`) require `VIBE_CRYPTO_MCP_TOKEN` when they listen beyond loopback.
- Shell tools are off unless you set `VIBE_TRADING_ENABLE_SHELL_TOOLS=1`.
- Remote access to the app itself (another computer, a phone, a LAN) is not supported. Hosting the MCP server for ChatGPT is a separate, token-protected setup. In Docker, publish the port on `127.0.0.1` and set `VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1`.

The reasoning is in [docs/vibe-crypto/ADR/0002-remove-auth.md](docs/vibe-crypto/ADR/0002-remove-auth.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Development

Run one test file at a time. The full suite is large.

```bash
. .venv/bin/activate
python -m pytest agent/tests/test_paper_runs.py -q
cd frontend && npx vitest run
cd frontend && npx tsc -b && npx vite build
cd desktop/electron && npm run build && node scripts/test-terminal.mjs
```

| Path | Contents |
|---|---|
| `agent/` | Python backend: FastAPI app (`api_server.py`), MCP server (`mcp_server.py`), CLI, backtest engine, tools |
| `agent/src/paper_runs/` | Forward paper runs |
| `agent/src/claude_chat/` | Claude chat backend |
| `frontend/` | React, Vite and Tailwind web UI; primitives in `src/components/ui/` |
| `desktop/electron/` | Electron shell and embedded terminal |
| `guides/` | User and developer guides |
| `cook/BRIEF.md` | UI design brief and tokens |
| `docs/vibe-crypto/` | Architecture decisions (`ADR/`), task notes (`handoff/`), `HANDOFF.md`, `TODO.md` |

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENT_CONTRIBUTOR_GUIDE.md](AGENT_CONTRIBUTOR_GUIDE.md) before sending changes.

## Disclaimer

Vibe Crypto is research and education software. It is not financial advice. Backtest and paper results do not guarantee live results: data can be revised, fills are simulated and markets change. You are responsible for any trade you place with a connector.

## Credits

Vibe Crypto is a fork of [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) by HKUDS, licensed under MIT. See LICENSE and NOTICE.

The code is released under the MIT License: see [LICENSE](LICENSE). Third-party notices are in [NOTICE](NOTICE). The bundled Inter and JetBrains Mono fonts are under the SIL Open Font License 1.1: see [frontend/public/fonts/LICENSE](frontend/public/fonts/LICENSE).
