# CLI, API and scheduled research

## 🖥 CLI Reference

The interactive TUI (`vibe-crypto`) now uses a terminal-native transcript: a startup banner, prompt rule, previous-turn recap, live activity rail, Markdown/table rendering, and run timing all stay in the CLI. Non-interactive invocations such as `vibe-crypto run`, pipes, and `--json` remain script-friendly.

```bash
vibe-crypto               # interactive TUI
vibe-crypto run -p "..."  # single run
vibe-crypto serve         # API server
vibe-crypto alpha list    # browse 478 pre-built alphas; show / bench / compare / export-manifest sub-commands available
vibe-crypto playbook list # five scheduled-research templates; show / create sub-commands available
vibe-crypto channels status --local  # inspect IM channel config and install hints
vibe-crypto provider doctor  # print redacted provider/proxy/package diagnostics
```

<details>
<summary><b>Slash commands inside TUI</b></summary>

| Command | Description |
|---------|-------------|
| `/help` | Show keyboard shortcuts and command list |
| `/model` | Switch LLM provider and model |
| `/memory` | Show / manage persistent memory |
| `/history` | Browse and resume prior sessions |
| `/goal` | Start / inspect a finance research goal |
| `/search` | Full-text search across all sessions |
| `/swarm` | Multi-agent presets (committee / quant / risk) |
| `/skill` | List / load / unload skills |
| `/show` | Show prior run by id |
| `/clear` | Clear current conversation |
| `/pine` | Export current strategy as Pine Script |
| `/journal` | Analyze trade journal CSV |
| `/shadow` | Train / view shadow account |
| `/export` | Export current session (md / json) |
| `/debug` | Toggle debug panel (token usage / latency) |
| `/comps` | Comparable company analysis (peer multiples -> implied range) |
| `/dcf` | Discounted cash flow valuation with sensitivity grid |
| `/attrib` | Brinson-Fachler attribution (allocation vs selection) |
| `/memo` | Investment memo — thesis, variant view, scenarios, kill criteria |
| `/earnings` | Earnings review — surprise bridge from revenue to EPS |
| `/screen` | Systematic idea screen — hypothesis, funnel, survivor queue |
| `/playbook` | Scheduled research templates (list / run / schedule) |
| `/connector` | Trading connector profiles (status / start / halt) |
| `/halt` | Kill switch — halt ALL live trading now |
| `/resume` | Clear the kill switch (re-enable live trading) |
| `/data` | Data partner settings |
| `/quit` | Exit (also: q, exit, :q) |

</details>

<details>
<summary><b>Single run & flags</b></summary>

If the final text-only response contains tool-call markup, the agent gets one
additional text-only turn beyond its iteration cap to re-emit the answer. This
turn cannot execute tools or continue research, still obeys cancellation and
goal token budgets, and is included in usage and iteration counts. If it also
returns tool-call markup, the existing degraded fallback is returned.

```bash
vibe-crypto run -p "Backtest BTC-USDT MACD strategy, last 30 days"
vibe-crypto run -p "Analyze AAPL momentum" --json
vibe-crypto run -f strategy.txt
echo "Backtest 000001.SZ RSI" | vibe-crypto run
```

```bash
vibe-crypto -p "your prompt"
vibe-crypto --skills
vibe-crypto --swarm-presets
vibe-crypto --swarm-run investment_committee '{"target":"TSLA","market":"US"}'
vibe-crypto --list
vibe-crypto --show <run_id>
vibe-crypto --code <run_id>
vibe-crypto --pine <run_id>           # Export indicators (TradingView + TDX + MT5)
vibe-crypto --trace <run_id>
vibe-crypto --continue <run_id> "refine the strategy"
vibe-crypto --upload report.pdf
```

```bash
vibe-crypto alpha list --zoo gtja191 --limit 10
vibe-crypto alpha show gtja191_171
vibe-crypto alpha bench --zoo gtja191 --universe csi300 --period 2018-2025 --top 20
```

</details>

<details>
<summary><b>IM channels</b></summary>

IM channel adapters connect outside chat apps to the same session runtime used by the Web UI and CLI. Configure enabled adapters under `channels` in `~/.vibe-trading/agent.json`; SDK-backed adapters are optional extras, and missing SDKs report recovery hints instead of crashing the runtime.

**Telegram quick start (pip installation):** activate the same virtual environment
in both terminals, then upgrade the package and install its Telegram adapter:

```bash
python -m pip install -U "vibe-crypto[telegram]"
vibe-crypto channels --help
```

Create a bot with `@BotFather`. Merge the following into
`~/.vibe-trading/agent.json`, replacing the token and sender ID (do not overwrite
other channel settings). `allow_from` accepts your numeric Telegram user ID or
username without `@`; listed senders do not need pairing approval.

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOTFATHER_TOKEN",
      "allow_from": ["YOUR_TELEGRAM_USER_ID"]
    }
  }
}
```

Run `vibe-crypto channels status --local` to check configuration and adapter
availability. Start `vibe-crypto serve --port 8000` in terminal 1, then run
`vibe-crypto channels start` in terminal 2 and send your bot a message.
For another port, set `VIBE_TRADING_API_URL` to that server's URL in terminal 2.
If `channels` is missing, check `python -m pip show vibe-crypto` in that
same environment and upgrade there; installing into one environment does not
update another environment's command. Missing SDK hints from `status --local`
mean the optional adapter still needs installation.

For long-running channel tasks, tune the central assistant-reply wait budget with `replyTimeoutS` (seconds, default `600`):

```json
{
  "channels": {
    "replyTimeoutS": 1800,
    "feishu": {
      "enabled": true
    }
  }
}
```

This controls how long the shared channel runtime waits for the agent session to produce an assistant message; adapter HTTP/socket timeouts remain adapter-specific.

```bash
vibe-crypto channels status --local   # inspect config and missing SDK hints without API
vibe-crypto channels status           # query the running API runtime
vibe-crypto channels start            # start enabled adapters through the API
vibe-crypto channels stop             # stop enabled adapters through the API
vibe-crypto channels login weixin     # run an adapter login hook when needed
vibe-crypto channels pairing --channel telegram list
```

Telegram long polling permits only one active `getUpdates` poller per bot
token. `vibe-crypto serve` owns the channel runtime; it starts channels at
startup when `VIBE_TRADING_CHANNELS_AUTO_START=true`, and the Web UI controls
that same runtime. `vibe-crypto channels start` sends a start request to the
running API server (`VIBE_TRADING_API_URL`, default
`http://127.0.0.1:8000`), so running it against that same server after
auto-start does not create another poller. Keep only one API server process
with a given Telegram bot token enabled. Separate server processes, or a CLI
configured to target a different server, each own a runtime and can conflict
when they use the same token.

`vibe-crypto channels login feishu` saves the QR-authorized app credentials to
`~/.vibe-trading/agent.json` with owner-only file permissions before reporting
login success.

The built-in adapters cover `websocket`, `telegram`, `slack`, `discord`, `matrix`, `whatsapp`, `signal`, `qq`, `napcat`, `weixin`, `wecom`, `feishu`, `dingtalk`, `msteams`, `email`, and `mochat`. Use narrow extras such as `pip install "vibe-crypto[telegram]"`, or install the full channel set with `pip install "vibe-crypto[channels]"`.

**In-chat slash commands** (channel-agnostic, work in all 16 adapters):

| Command | Description |
|---------|-------------|
| `/new` | Reset the current session — the next message starts a fresh conversation |
| `/reset` | Alias for `/new` |
| `/newsession` | Alias for `/new` |
| `/pairing list` | Show pending sender-pairing requests (operators only) |

Commands are case-insensitive and must be sent as the entire message (e.g. `hello /new` is treated as a regular message, not a reset).

> **`/pairing` is operator-gated.** In-chat pairing-control commands are rejected unless the sender is listed as an operator — set `channels.operators` (cross-channel authority) or a channel section's own `operators` list in your channels config. With no operators configured, in-chat `/pairing` is refused (fail-closed) and pairing is managed only through the authenticated CLI (`vibe-crypto channels pairing …`) and the auth-gated REST endpoint. This prevents any allow-listed group member from taking over pairing across channels.

**Configure from the Web UI**: the **IM Channels** panel on the Settings page configures channels without hand-editing files. Expand a channel to open its config panel: fields render from backend metadata, and secret values are never returned to the browser, only masked (`****` plus the last 4 characters). DingTalk is the first fully-guided channel: create an app at [open-dev.dingtalk.com](https://open-dev.dingtalk.com/), add the bot capability, enable Stream Mode (no public callback URL needed), copy the AppKey into Client ID and the AppSecret into Client Secret, then publish the app. QQ has joined it as a fully-guided channel: register a bot on the QQ Open Platform ([q.qq.com](https://q.qq.com/)), copy the AppID and AppSecret into the form, verify with **Test connection** before saving, then enable; no public callback URL is needed (WebSocket via the official botpy SDK). Email and WebSocket have joined as fully-guided channels: Email's **Test connection** probes the IMAP login, the mailbox folder and the SMTP login against your provider without sending anything, while WebSocket — a local server rather than a remote service — validates the TLS certificate/key material and the address availability on this machine; an address held by the already-running server reads as the expected state, not a failure. Saving a WebSocket config hot-swaps the server, so connected clients (including the Web UI chat) briefly disconnect and reconnect. Feishu has joined them as a fully-guided channel: create a custom app on the Feishu Open Platform ([open.feishu.cn](https://open.feishu.cn/), or [open.larksuite.com](https://open.larksuite.com/) for international Lark), add the bot capability, select the matching domain in the form, copy the App ID and App Secret, verify with **Test connection** before saving, then enable; no public callback URL is needed (WebSocket long connection via the official lark-oapi SDK). **Test connection** probes the values in the form before anything is saved and answers with an honest result code (`ok`, `invalid_credentials`, `network`, or `unsupported`). **Enable** applies immediately: a running channel runtime hot-swaps that one adapter with no process restart, and enabling auto-verifies credentials unless you explicitly choose **Enable anyway** after a failed check. Disabling a channel keeps its stored credentials, so re-enabling needs no re-entry. Only the built-in adapters are listed here; entry-points plugin channels remain file-configured.

Saves write the `channels.<name>` section of `~/.vibe-trading/agent.json` atomically. YAML config files are read-only for the web UI (JSON is required to edit from the browser), and the panel says so instead of failing. Channels without a dedicated guide render a generic form derived from their defaults.

</details>

## 🌐 API Server

```bash
vibe-crypto serve --port 8899
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/runs` | List runs |
| `GET` | `/runs/{run_id}` | Run details |
| `GET` | `/runs/{run_id}/pine` | Multi-platform indicator export |
| `POST` | `/sessions` | Create session |
| `POST` | `/sessions/{id}/messages` | Send message |
| `GET` | `/sessions/{id}/events` | SSE event stream |
| `POST` | `/upload` | Upload a document, data file, or image |
| `GET` | `/swarm/presets` | List swarm presets |
| `POST` | `/swarm/runs` | Start swarm run |
| `GET` | `/swarm/runs/{id}/events` | Swarm SSE stream |
| `GET` | `/alpha/list` | List alphas (filter by zoo/theme/universe) |
| `GET` | `/alpha/{alpha_id}` | Alpha metadata + source code |
| `POST` | `/alpha/bench` | Start a bench job (returns `job_id`) |
| `GET` | `/alpha/bench/{job_id}/stream` | SSE progress stream |
| `GET` | `/settings/llm` | Read Web UI LLM settings |
| `PUT` | `/settings/llm` | Update local LLM settings |
| `GET` | `/settings/data-sources` | Read local data source settings |
| `PUT` | `/settings/data-sources` | Update local data source settings |
| `GET` | `/channels/status` | Read IM channel runtime and adapter status |
| `POST` | `/channels/start` | Start configured IM channel adapters |
| `POST` | `/channels/stop` | Stop configured IM channel adapters |
| `POST` | `/channels/pairing/command` | Run a sender-pairing command against the shared store |
| `POST` | `/scheduled-runs` | Create a scheduled research job (interval-ms or cron) |
| `GET` | `/scheduled-runs` | List scheduled jobs |
| `GET` | `/scheduled-runs/status` | Executor state and configured delivery targets |
| `GET` | `/scheduled-runs/{job_id}` | Read one scheduled job |
| `DELETE` | `/scheduled-runs/{job_id}` | Cancel a scheduled job |
| `POST` | `/scheduled-runs/proposals/{proposal_id}/commit` | Confirm an agent-proposed create/cancel |
| `POST` | `/scheduled-runs/proposals/{proposal_id}/discard` | Discard an agent proposal |
| `GET` | `/scheduled-runs/playbooks` | List the research templates |
| `GET` | `/scheduled-runs/playbooks/{slug}` | Show one template, with its variables |
| `POST` | `/scheduled-runs/playbooks/{slug}` | Schedule a job from a template |
| `POST` | `/sessions/{id}/cancel` | Stop the session's in-flight run (recorded as cancelled, not failed) |
| `POST` | `/sessions/{id}/title/auto` | Summarize the first exchange into a session title (never overwrites a manual rename) |
| `GET` | `/correlation/regime` | Correlation edge-density regime timeline |
| `GET` | `/agents.json` · `POST` `/v1/query` | OpenBB Workspace bridge, registered only with the optional `openbb` extra |

Interactive docs are available at `http://localhost:8899/docs` (and `/redoc`) to clients on this computer. The paper run and Claude chat routes are described below.

### Paper runs

A paper run replays a backtested strategy forward from the moment you start it, using the same engine as the backtest. Details: [ADR 0004](../docs/vibe-crypto/ADR/0004-paper-trading.md). Errors are `404 {"detail":"Paper run not found"}` and `422 {"detail":"<message>"}`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/paper-runs` | Create a run. Body: `{"run_id": "<backtest run id>", "label": "optional", "initial_cash": 10000, "warmup_days": 180}`. Only `run_id` is required. Returns the run document. |
| `GET` | `/api/paper-runs` | List runs, newest first |
| `GET` | `/api/paper-runs/{id}` | Run detail: `run`, `equity`, `trades` (newest first), `positions`. Does not recompute. |
| `POST` | `/api/paper-runs/{id}/refresh` | Recompute with the latest data and return the detail. Can take several seconds. |
| `POST` | `/api/paper-runs/{id}/stop` | Freeze the end date at today and return the detail. A stopped run can still be refreshed. |
| `DELETE` | `/api/paper-runs/{id}` | Delete the run. Returns `{"deleted": true}`. |

The run document has `id`, `label`, `source_run_id`, `codes`, `source`, `interval`, `initial_cash`, `started_at`, `evaluation_start`, `status` (`active` or `stopped`), `state` (`waiting`, `ok` or `error`), `last_error` and `summary` (`equity`, `pnl`, `total_return`, `max_drawdown`, `sharpe`, `trade_count`, `bars`, `as_of`). State is `waiting` until two forward bars exist. There is no background scheduler: call refresh to update a run. Manual paper accounts for `us`, `hk` and `cn_a` remain under `/api/paper-accounts`.

### Claude chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/claude/status` | Readiness probe: `{"available", "sdk_version", "auth", "model", "error"}`. `auth` is `api_key`, `claude_login` or `unknown`. Never starts a process. |
| `POST` | `/api/claude/chat` | Send one message and stream the reply as server-sent events |

`POST /api/claude/chat` takes `{"message": "...", "session_id": "optional, resumes a conversation", "model": "optional"}`. Each frame is `event: <type>` followed by `data: <json>`. Event types:

| Event | Fields |
|-------|--------|
| `session` | `session_id`, sent first so the client can resume later |
| `text` | `delta`, a piece of the reply |
| `tool_use` | `id`, `name`, `input` |
| `tool_result` | `tool_use_id`, `is_error`, `preview` (first 2000 characters) |
| `done` | `session_id`, `is_error`, `cost_usd`, `duration_ms` |
| `error` | `message` |

The chat gives Claude only the Vibe Crypto MCP tools (no file or shell tools) and does not read your Claude Code settings. It needs `ANTHROPIC_API_KEY` or a logged-in Claude Code. See [docs/vibe-crypto/CLAUDE_CODE.md](../docs/vibe-crypto/CLAUDE_CODE.md) for the MCP server itself.

### Security defaults

Vibe Crypto is a local, single-user app and has no login, API key or token. Instead the API guards itself against other machines and other websites ([ADR 0002](../docs/vibe-crypto/ADR/0002-remove-auth.md)):

- Requests are accepted only from loopback peers. Anything else gets `403`. Remote access (LAN, phone, another computer) is not supported.
- Host headers are checked, which stops DNS rebinding.
- Cross-site browser requests that change state are rejected, so a website you visit cannot drive the local API.
- Security headers are set on every response.
- Under Docker, publish the port on `127.0.0.1` and set `VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1`.

Broker and exchange credentials are separate. They are stored locally and are not an app login.

Shell-capable process tools (`bash` / `background_run` / `cancel_background`) are enabled only for the interactive local CLI. Every other surface — the HTTP/SSE API and the MCP server on **all** transports (stdio included) — keeps them off unless you explicitly opt in with `VIBE_TRADING_ENABLE_SHELL_TOOLS=1` (or pass `--enable-shell-tools` to `vibe-crypto-mcp`). Transport type never implicitly grants shell access. `cancel_background` stops only the tracked task ID returned by `background_run`; broad Python process-name termination is refused because it could terminate Vibe Crypto itself. A background task and the notice that it finished belong to the session or swarm worker that started them: another conversation cannot list the task, read its output or cancel it, and only the owner is shown the result. Document and journal readers are limited to upload/import roots by default; place files under `~/.vibe-trading/uploads`, `~/.vibe-trading/runs`, `./uploads`, `./data` (or the legacy `agent/uploads` / `agent/runs`), or add a dedicated directory through `VIBE_TRADING_ALLOWED_FILE_ROOTS`. Sessions, runs, swarm runs, uploads, and the `sessions.db` index live under `~/.vibe-trading` (relocatable via the `VIBE_TRADING_HOME` shell environment variable); pre-existing history is moved there automatically on first run.

Generated backtest code runs as a local Python subprocess and can make network requests through the configured market-data loaders. Its environment is intentionally narrow: the runner keeps OS/Python basics, proxy/certificate settings, `VIBE_TRADING_ALLOWED_RUN_ROOTS`, and read-only market-data keys such as `TUSHARE_TOKEN`, `FMP_API_KEY`, `FRED_API_KEY`, and `VIBE_TRADING_IWENCAI_KEY`. It does not pass LLM provider keys, API auth tokens, shell-tool switches, broker trading secrets, or live/advisory toggles to generated strategy code by default.

### Web UI Settings

The Web UI Settings page lets local users update the LLM provider/model, base URL, generation parameters, reasoning effort, and optional market data credentials such as the Tushare token. Settings are persisted to `agent/.env`; provider defaults are loaded from `agent/src/providers/llm_providers.json`.

Settings reads are side-effect free: `GET /settings/llm` and `GET /settings/data-sources` never create `agent/.env`, and they only return project-relative paths. Settings reads and writes can expose credential state or update credentials/runtime environment, so they are accepted only from this computer and, for writes, only from same-site requests.

The same Settings page includes an **IM Channels** panel for local operators. It polls `/channels/status`, shows configured/enabled/available/loaded/running states, surfaces adapter recovery hints, and can start or stop the configured channel runtime without going back to the terminal.

### Scheduled research

Run a research prompt or backtest on a repeating schedule — from the **Scheduled** page in the web UI or over REST. The background executor is **off by default** — start the server with `VIBE_TRADING_ENABLE_SCHEDULER=1` to enable it:

```bash
VIBE_TRADING_ENABLE_SCHEDULER=1 vibe-crypto serve --port 8899
```

Then create jobs over REST. Send `schedule` as a JSON **string** containing an interval in milliseconds or a cron expression. For a six-hour interval, use `{"prompt":"Summarize market news","schedule":"21600000"}`. For wall-clock scheduling, use a five-field cron expression (`min hour dom mon dow`; each field takes `*`, `*/n`, numbers, comma lists, or low-high ranges like `1-5`). Cron runs on the wall clock of the job's optional `timezone` (an IANA key), so the cadence holds across DST transitions — a spring-forward gap time is skipped, and a fall-back ambiguous time runs once, at its first occurrence. Jobs without a `timezone` keep plain UTC semantics:

```bash
# every 6 hours (cron)
curl -X POST http://localhost:8899/scheduled-runs \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Scan CSI300 for momentum breakouts and backtest the top 5","schedule":"0 */6 * * *"}'

# weekdays at 23:30 Auckland wall time — DST-proof
curl -X POST http://localhost:8899/scheduled-runs \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Pre-open scan of NZX names","schedule":"30 23 * * 1-5","timezone":"Pacific/Auckland"}'

# list / cancel
curl http://localhost:8899/scheduled-runs
curl -X DELETE http://localhost:8899/scheduled-runs/<job_id>
```

Each fire runs the `prompt` through a fresh agent session (optional backtest parameters go in `config`), and jobs persist under `~/.vibe-trading/` so they survive restarts. Without the flag, the `/scheduled-runs` endpoints still record jobs but nothing fires.

The agent sees exactly one scheduling tool, `scheduled_research`. Its read
actions inspect status/jobs/playbooks; `propose_create` and `propose_cancel`
only persist a short-lived confirmation proposal. They never mutate the job
store. Web renders a deterministic confirmation card, CLI asks `y/N`, and IM
conversations require an exact `confirm` (`确认`) or `cancel` (`取消`); only
that surface action calls the commit endpoint. Create drafts carry `title`, `source`, `schedule`,
`end_at`, and `delivery`. Once `end_at` passes, the retained job becomes
`expired` and is not dispatched again.

Scheduled delivery is channel-agnostic. Configure reusable opaque target refs
under `channels.deliveryTargets`; the agent tool and its confirmation surfaces
expose the ref, label, and channel but never the provider's raw chat/user id.
For Email PDF reports, an operator can set the private `pdf_password` field in
Settings → IM Channels → Email. The Scheduled page then offers optional PDF
protection only for PDF delivery. The password stays in Email channel config;
jobs persist only the protection boolean, and requesting protection without a
configured password is rejected.

For CLI playbooks, add `--protect-pdf` alongside `--delivery-format pdf` and
an Email destination, for example:

```bash
vibe-crypto playbook create premarket-brief --delivery-target-ref research-email \
  --delivery-format pdf --protect-pdf
```

The existing direct REST/admin fields remain available for backward
compatibility:

```json
{
  "channels": {
    "deliveryTargets": {
      "research-team": {
        "label": "Research Team",
        "channel": "feishu",
        "target": "<provider chat or user id>"
      }
    }
  }
}
```

Any configured channel adapter can be selected. Delivery status is `accepted`
when an adapter succeeded without a provider receipt, and `sent` only when the
adapter returned a provider message id (currently implemented end to end for
Feishu). Failures remain retryable in the persisted outbox.

On the Web UI, scheduled jobs can be edited in place: prompt, cadence/timezone, and delivery settings are updated with `PATCH /scheduled-runs/{job_id}` without deleting the job, so its id and run history stay intact. A job that is currently running refuses edits until that dispatch finishes. Delivery remains operator-controlled: each channel adapter describes the destination label, placeholder, and input type, while the manual target field remains available. Adapters may also expose optional known-destination suggestions; selecting one only fills that same manual field. Telegram, for example, can suggest numeric private-chat ids already present in its local `allow_from` list, while usernames and wildcards are ignored.

**Five ready-to-schedule templates** ship with the scheduler — `premarket-brief`, `earnings-season-tracker`, `portfolio-checkup`, `a-share-money-flow`, `institutional-holdings-diff`. Each states the data a run needs in plain language instead of naming tools, so a template keeps working as the tool surface grows, and each is required to name a missing input rather than fill it from memory. Reach them from the CLI, over REST, or with `/playbook` in the TUI:

```bash
vibe-crypto playbook list                     # the five templates
vibe-crypto playbook show premarket-brief     # body, declared variables, suggested cadence
vibe-crypto playbook create premarket-brief \
  --var home_market="US equities" --var watchlist="AAPL, MSFT, NVDA" \
  --timezone America/New_York

curl http://localhost:8899/scheduled-runs/playbooks
curl http://localhost:8899/scheduled-runs/playbooks/premarket-brief
curl -X POST http://localhost:8899/scheduled-runs/playbooks/premarket-brief \
  -H "Content-Type: application/json" \
  -d '{"variables":{"home_market":"US equities","watchlist":"AAPL, MSFT, NVDA"}}'
```

Posting `{}` schedules a template on its own suggested cadence with its declared defaults. The rendered body becomes the job prompt verbatim, and an undeclared variable is rejected rather than silently ignored.

## Research Lab

[Research Lab](research-lab.md) provides shared Web, CLI, Agent/MCP and REST
entry points for frozen-input cost scenarios, training-only parameter selection
and OOS/holdout execution, source/history audits and offline task replays.
Run `vibe-crypto research-lab --help` or open `/research-lab`.
