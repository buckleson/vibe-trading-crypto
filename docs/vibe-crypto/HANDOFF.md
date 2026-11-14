# Vibe Crypto: handoff

Final handoff after the integration pass (2026-11-14). Per-task detail is in
`docs/vibe-crypto/handoff/<TASK_ID>.md`; decisions are in `docs/vibe-crypto/ADR/` (ADR 0008 covers sharing, the Claude plugin and extension, and the remote MCP), the
checklist in `docs/vibe-crypto/TODO.md`, the UI brief and tokens in `cook/BRIEF.md`.
Screenshots of every main page (light and dark, 1440x900) are in
`docs/vibe-crypto/screenshots/`.

## Current state

What works and how it was checked in the sandbox (Python 3.13 venv, Node 22, no exchange
access; Anthropic traffic goes through the sandbox's Claude login).

- **Rebrand.** Package `vibe-crypto`, commands `vibe-crypto` and `vibe-crypto-mcp` (old
  `vibe-trading*` names kept as aliases), UI, desktop, CI and docs renamed. Upstream
  attribution kept in LICENSE, NOTICE and README Credits. All markets (stocks, crypto, futures,
  options, A-shares and the rest) are still there.
- **No app auth.** No login, API key, Bearer or SSE tickets. A local request guard remains
  (loopback peers, Host and Origin checks; a cross-site POST gets 403). Broker and exchange
  credential storage and the wallet button are kept.
- **UI.** Tokens, `components/ui/` primitives, sidebar, top bar, assistant dock and redesigned
  pages. Checked in Chromium at 1440x900 in light and dark: no console errors on any page.
- **Paper trading.** Strategy runs (start from a finished backtest, P&L, positions, equity curve,
  trade history, refresh, stop, delete) and the manual accounts tab. Checked in the browser with
  a seeded run; real refreshes need market data (blocked in the sandbox).
- **Claude chat panel.** `/api/claude/status` and `/api/claude/chat` (SSE) through the Claude
  Agent SDK with the app's MCP tools. A real chat streamed a reply in the sandbox using the
  Claude Code login.
- **Claude Code CLI.** 87 MCP tools including `paper_run_*`; `vibe-crypto mcp install`,
  `vibe-crypto mcp config`, project `.mcp.json`.
- **Desktop.** Electron shell with platform-aware backend lookup and an embedded terminal
  (`node-pty` + xterm) that runs the local `claude` with the MCP server wired. Builds with
  `tsc`; the Electron binary itself was not launched here.
- **Sharing.** Friends install their own copy (ADR 0008, `guides/share-with-friends.md`): Claude Code
  plugin from `.claude-plugin/marketplace.json` (`plugins/vibe-crypto`), Claude Desktop `.mcpb`
  (`extensions/claude-desktop`, attached to each GitHub release by `desktop-windows.yml`, desktop
  version 0.4.0), or `uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp`.
  The http and sse transports take `VIBE_CRYPTO_MCP_TOKEN` (header or `/<token>/mcp`) and refuse a
  non-loopback bind without it. Order tools are off unless `--enable-order-tools` or
  `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1`. ChatGPT needs a self-hosted HTTPS server: your PC plus a tunnel, or
  `deploy/gcp/deploy.sh` (Cloud Run, Secret Manager token, Cloud Storage data folder). The Cloud Run
  path was only dry-run, never deployed.
- **CI.** `.github/workflows/test.yml` (tests) and `.github/workflows/desktop-windows.yml`
  (the only build: Windows installer uploaded as an artifact). Docker, wiki and loader-health
  workflows were deleted.

### Verified commands (2026-11-14, final integration)

| Command | Result |
|---|---|
| `pytest agent/tests --ignore=agent/tests/e2e` (whole suite) | 22762 passed, 42 failed, 180 skipped in 9 min. After the fixes below, every fork-related failure passes; the rest are listed in "Still failing" |
| `pytest agent/tests/vibe_crypto` + paper runs, Claude chat, MCP, local guard, gitignore, manifest, capability matrix, `tools/` | 1310 passed, 2 skipped |
| `bash tools/ci_grep_gates.sh` | all gates pass |
| `cd frontend && npx tsc -b && npm run build` | exit 0 (one Vite warning: TerminalPanel imported statically and dynamically) |
| `cd frontend && npx vitest run` | 136 files, 2472 tests, all pass |
| `cd desktop/electron && npm run build` | exit 0 |
| `node scripts/test-{backend-resolution,locales,terminal,packaging-preparation,update-safety,rebrand-T01,T02,T11}.mjs` | all exit 0 |
| `vibe-crypto serve`, then `GET /health`, `/api/paper-runs`, `/api/paper-accounts`, `/api/claude/status`, `/runs`, `/sessions` | all 200 with no auth header |
| `POST /api/paper-runs {"run_id":"nope"}` | 422 with a clear message |
| `POST /api/claude/chat {"message":"hi"}` | SSE stream: `session` then `text` events (real reply) |
| MCP stdio client against `vibe-crypto-mcp` | 87 tools listed, `paper_run_list` returns `{"status":"ok","runs":[]}` |
| `python -c "import yaml; yaml.safe_load(...)"` on both workflows | parse OK |
| `pytest agent/tests/vibe_crypto` (T15 to T18 added) | 1363 passed, 8 skipped |
| `pytest agent/tests/test_mcp_remote_auth.py agent/tests/test_mcp_order_tools_optin.py` | 22 passed |
| `uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --help` (T16, GitHub main) | exit 0, 4 s warm and 16 s cold; MCP handshake listed 87 tools |
| `claude plugin validate` on the repo and `plugins/vibe-crypto`, then a real plugin install in an isolated HOME (T16) | validation passed; `claude mcp list` shows the plugin server Connected |
| `mcpb validate` and `mcpb pack extensions/claude-desktop` (T17) | pass, 3 files and about 22 kB |
| `vibe-crypto-mcp --transport http --host 0.0.0.0` with no token (T15) | exit 2 with a refusal message; `/<token>/mcp` returns 200, no credentials returns 401 |
| `bash -n` and shellcheck on `deploy/gcp/deploy.sh` and `teardown.sh`; `deploy.sh --dry-run --project demo-proj --region europe-west1` (T18) | exit 0, full gcloud sequence printed, 0 gcloud calls |
| Final check: `pytest agent/tests/vibe_crypto agent/tests/*mcp*` | 1830 passed, 8 skipped |
| Final check: MCP stdio client against `uvx --python 3.12 --with keyring --from <path> vibe-crypto-mcp` for the working tree, `git+https://github.com/buckleson/vibe-trading-crypto` and the `archive/refs/heads/main.zip` URL used by the `.mcpb` | 87 tools each; working tree with `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1` lists 89 (adds `trading_place_order`, `trading_cancel_order`). GitHub reflects the last pushed commit, which predates T15 |
| Final check: `VIBE_CRYPTO_MCP_TOKEN=<t> vibe-crypto-mcp --transport http` (and `sse`) on 127.0.0.1 and 0.0.0.0, mcp python client | no token or wrong token: 401; Bearer header and `/<t>/mcp` (`/<t>/sse`): initialize, 87 tools, `list_skills` call OK; `Host: x.trycloudflare.com` + path token: 200 |
| Final check: `claude plugin validate .` and `plugins/vibe-crypto`; `mcpb@2.1.2 validate` + `mcpb pack` + `mcpb info` | all pass, no warnings after adding `plugins/vibe-crypto/.claude-plugin/icon.png`; bundle 23 kB, 3 files, unsigned |

### Still failing (not caused by the fork)

- `test_get_market_data_size.py` (7) and `test_swarm_m4_e2e.py` (1): fail the same way on the
  untouched upstream baseline `d19d1ac` in this sandbox.
- `test_ou_missing_lag_pairs_regressions.py` (3): need `statsmodels` (the `stats` extra; CI
  installs it).
- `test_strategy_adaptation_workflow.py::test_real_local_backtest_to_child_evidence`: US equity
  `commission` rejection, environment specific (risk 21 below).
- The no-key error path of the Claude chat could not be shown live: the sandbox always has a
  Claude login. It is covered by `test_claude_chat*.py` with a mocked SDK. With a bad base URL
  the bundled `claude` CLI retries for minutes before failing.

## How to run

All commands from the repo root unless noted.

### Backend and built web UI

```bash
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\Activate.ps1
pip install -e .
vibe-crypto init                                  # creates ~/.vibe-trading/.env
vibe-crypto setup                                 # installs frontend deps and builds the UI
vibe-crypto serve                                 # open http://127.0.0.1:8899
```

### Frontend dev server

```bash
cd frontend
npm install
npm run dev            # http://localhost:5899, proxies the API to 127.0.0.1:8899
```

### Desktop app (Windows, macOS, Linux)

```bash
pip install -e .       # once, from the repo root (macOS and Linux use this backend)
cd desktop/electron
npm install
npm run rebuild:native # once: builds node-pty for Electron (needs Python 3, make, a C++ compiler)
npm start
```

Windows users can instead download the installer from GitHub: Actions, "Desktop (Windows)",
latest run on `main`, artifact `vibe-crypto-windows` (NSIS installer, `SHA256SUMS.txt` and a
`win-unpacked` zip). It is unsigned, so SmartScreen asks for confirmation. Local packaging:
`npm run installer:win:review` (Windows), `npm run dist:mac`, `npm run dist:linux`.

### Claude, three ways

1. **In-app chat.** Click Claude in the top bar or press Ctrl/Cmd+J. The panel uses
   `ANTHROPIC_API_KEY` if set, otherwise your Claude Code login (`claude login`). Settings,
   Claude shows which one is in use. Optional model override: `VIBE_CRYPTO_CLAUDE_MODEL`.
   Claude can list backtests, start and check paper runs, fetch data and run backtests through
   the app's tools.
2. **Claude Code CLI.** With the virtualenv active:

   ```bash
   claude mcp add vibe-crypto -- vibe-crypto-mcp
   ```

   or `vibe-crypto mcp install` (absolute paths, works without an active virtualenv). Check with
   `claude mcp list`. Full guide: `docs/vibe-crypto/CLAUDE_CODE.md`.
3. **Embedded terminal (desktop only).** Open the dock, Terminal tab. It runs your local
   `claude` with `--mcp-config <userData>/claude-mcp.json`, so the Vibe Crypto tools are already
   connected. Needs `claude` on PATH.

### Paper trade a strategy

1. Run a backtest (Research assistant, or ask Claude). Open it from Backtest reports.
2. On the run page click "Run on paper", or go to Paper trading, Start paper run and pick the
   backtest. Set a label and starting cash.
3. The run counts from the next bar after you start. Open it to see equity, P&L, return, max
   drawdown, Sharpe, positions, the equity curve and trade history. It refreshes when opened
   and every 5 minutes while visible; Refresh forces it. Stop freezes the results.
4. From Claude: "Start a paper run from my best backtest", "How are my paper runs doing?".

No orders are sent anywhere. Live trading uses the existing broker connectors, unchanged.

### Share with friends (what to send them)

Each friend runs their own copy with their own broker keys; there is no shared server.
Everything except the clone-free Cloud Run path needs uv
(<https://docs.astral.sh/uv/getting-started/installation/>). Full guide, broker list and safety
rules: `guides/share-with-friends.md`. Order tools are off unless turned on
(`VIBE_CRYPTO_MCP_ENABLE_ORDERS=1`); live orders still need a mandate and pass the kill switch.

- **Claude Code** (plugin: MCP server, `/vibe-crypto:connect-broker`, `:portfolio`, `:paper-run`,
  `:status`, skill `safe-trading`):

  ```text
  /plugin marketplace add buckleson/vibe-trading-crypto
  /plugin install vibe-crypto@vibe-crypto
  ```

  Without the plugin: `claude mcp add vibe-crypto -- uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp`

- **Claude Desktop**: open
  <https://github.com/buckleson/vibe-trading-crypto/releases/latest/download/vibe-crypto-claude-desktop.mcpb>
  (works once release v0.4.0 is published, risk 25). Manual alternative in
  `claude_desktop_config.json` (same block for Cursor in `~/.cursor/mcp.json`):

  ```json
  {"mcpServers": {"vibe-crypto": {"command": "uvx", "args": ["--python", "3.12", "--with", "keyring",
    "--from", "git+https://github.com/buckleson/vibe-trading-crypto", "vibe-crypto-mcp"]}}}
  ```

- **Any stdio MCP client**: `uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp`
  (add broker packages with `--with keyring,alpaca-py`, see the broker table in the guide).

- **ChatGPT via their own PC and a tunnel**:

  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(32))"      # -> <token>
  VIBE_CRYPTO_MCP_TOKEN=<token> uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp --transport http --port 8900
  cloudflared tunnel --url http://127.0.0.1:8900                       # or: ngrok http 8900
  ```

  ChatGPT: Settings > Apps & Connectors > Advanced > Developer mode, create a connector with URL
  `https://<tunnel-host>/<token>/mcp` and Authentication "No authentication".

- **ChatGPT via their own Google Cloud Run**:

  ```bash
  git clone https://github.com/buckleson/vibe-trading-crypto && cd vibe-trading-crypto
  deploy/gcp/deploy.sh --project <their-project> --region <region> --dry-run
  deploy/gcp/deploy.sh --project <their-project> --region <region>   # prints https://<service-url>/<token>/mcp
  deploy/gcp/teardown.sh --project <their-project> --region <region> # remove it
  ```

  Add the printed URL in ChatGPT as above. Not yet deployed for real (risk 26).

### Tests

```bash
. .venv/bin/activate
python -m pytest agent/tests/vibe_crypto -q
python -m pytest agent/tests -q --ignore=agent/tests/e2e     # whole suite, about 9 minutes
bash tools/ci_grep_gates.sh
cd frontend && npx tsc -b && npx vitest run
cd desktop/electron && npm run build && node scripts/test-terminal.mjs
```

### CI

- `test.yml`: Windows hash-lock check of `desktop/electron/requirements-windows-lock.txt`,
  pytest on Python 3.11 and 3.14 (includes `agent/tests/vibe_crypto`), frontend build and
  vitest, desktop shell build and node tests on Linux, Windows background and Electron
  lifecycle tests.
- `desktop-windows.yml`: on push to `main` and manual dispatch. Builds the frontend, rebuilds
  `node-pty` for Electron, runs desktop checks, assembles the embedded Python runtime, builds
  the NSIS installer, smoke-tests it and uploads the installer, `SHA256SUMS.txt` and the
  `win-unpacked` zip with `actions/upload-artifact` (pinned SHA, v7.0.2).
- Neither workflow was run here (no GitHub runner); YAML parses and the T01/T11 tests check
  names and steps.

## Where things live

| Area | Path |
|---|---|
| FastAPI app and route registration | `agent/api_server.py`, `agent/src/api/*_routes.py` |
| Local request guard (was auth) | `agent/src/api/security.py` |
| MCP server (all Claude tool access) | `agent/mcp_server.py` |
| CLI | `agent/cli/_legacy.py` (argparse), `agent/cli/main.py`, `agent/cli/commands/mcp_setup.py` |
| LLM providers for the built-in agent | `agent/src/providers/` (`llm.py`, `claude_cli.py`) |
| Backtest engine and loaders | `agent/backtest/` |
| Manual paper accounts (us/hk/cn_a) | `agent/src/tools/paper_trade/`, `agent/src/api/paper_trade_routes.py` |
| Paper runs | `agent/src/paper_runs/service.py`; routes in `agent/src/api/paper_trade_routes.py` |
| Claude chat backend | `agent/src/claude_chat/service.py`, `agent/src/api/claude_chat_routes.py` |
| Runtime data | `~/.vibe-trading/` (runs, sessions, paper-trading, paper-runs); `VIBE_TRADING_HOME` moves it |
| Frontend routes and shell | `frontend/src/router.tsx`, `frontend/src/components/layout/` |
| UI primitives | `frontend/src/components/ui/` |
| Claude chat UI | `frontend/src/components/claude/`, `frontend/src/lib/claudeChat.ts` |
| Paper trading UI | `frontend/src/pages/PaperTrading.tsx`, `frontend/src/components/paper/`, `frontend/src/lib/paperRuns.ts` |
| Terminal UI and wallet | `frontend/src/components/terminal/`, `frontend/src/components/wallet/`, `frontend/src/lib/wallet.ts` |
| API client | `frontend/src/lib/api.ts` (`request` is exported for new clients) |
| i18n | `frontend/src/i18n/locales/*.json` (parity tested) |
| Electron | `desktop/electron/src/` (`main.ts`, `backend-manager.ts`, `terminal-manager.ts`, `preload.ts`) |
| Docs | `README.md`, `guides/`, `docs/vibe-crypto/` |

## Conventions for agents

- Stay inside your task's owned paths. If you must touch another file, keep the edit minimal
  and list it in your handoff note.
- New UI copy: `t("ns.key", { defaultValue: "English" })`, and add the key to every locale file.
- New frontend API clients go in their own `frontend/src/lib/<feature>.ts` importing `request`
  from `@/lib/api`.
- Do not commit or push unless asked. Do not hit live exchanges or the Anthropic API in tests.
- Run targeted tests for what you touch, then the full frontend suite if you touched `frontend/`.
- Write `docs/vibe-crypto/handoff/<ID>.md`: what changed, commands run with results, known
  gaps, follow-ups.

## Open risks and follow-ups

Merged from handoff notes T01 to T13, the T14 sweep and the final integration pass. Ordered by what blocks a clean release.

| # | Risk or follow-up | Owner area | Next step |
|---|---|---|---|
| 1 | Resolved: full frontend suite passes (136 files). | Frontend tests, `frontend/src/i18n/locales/en.json` | Done |
| 2 | Resolved: `test_T01.py` expectations updated to the final state (T02 auth identifiers removed on purpose, T06 dependency, T07 tools, redesigned locale keys). | Python and frontend rebrand tests | Done |
| 3 | Resolved: `claude_chat/service.py` reads env through `src.config.accessor.get_env_value`; all gates pass. | Backend config | Done |
| 4 | Resolved: `Layout` and `AssistantDock` listen for `vc:open-dock` (test in `T03.shell.test.tsx`). | Frontend layout | Done |
| 5 | Resolved: `.gitignore` uses `/docs/*` plus `!docs/vibe-crypto/`; `ci_private_files_gate.py` allows `docs/vibe-crypto/` (private names still rejected), with tests. | Repo hygiene | Done |
| 6 | `agent/tests/test_readme_counts.py` parsed the upstream README's tool lists, badges and tables. It is skipped at module level (T14) because the README no longer has them. | Python tests | Delete it, or rewrite a smaller count check against `guides/mcp.md`. |
| 7 | The generated broker table in README and `guides/portfolio-and-brokers.md` uses em dashes (`src/trading/capability_matrix.py`). | Backend docs generator | Change the placeholder to "-" and regenerate with `PYTHONPATH=agent python -m src.trading.capability_matrix`. |
| 8 | Paper runs depend on live data. All loaders are blocked in the sandbox; only mocked tests prove the flow. No real-engine end-to-end test (`local_loader` reads a fixed `~/.vibe-trading` config). | Paper runs | Run one real OKX or CCXT paper run on a normal machine. Add a hermetic e2e if loaders get a config hook. |
| 9 | Paper runs have no scheduler: results update only on refresh (UI open, 5 minute timer while visible, MCP request). A vendor revising past bars can shift history slightly. `get` and `detail` do not refresh. | Paper runs | Decide whether a background refresh is wanted. Keep the UI help text. |
| 10 | Claude chat ran once against a real Claude Code login in the sandbox (streamed reply); never with an `ANTHROPIC_API_KEY`. Detection of API key versus Claude Code login is best effort. One MCP subprocess starts per message (2 to 5 s). | Claude chat | Manual check with each auth mode. Consider `ClaudeSDKClient` only if the delay hurts. |
| 11 | Resolved: `requirements-lock.txt` and `desktop/electron/requirements-windows-lock.txt` regenerated with `claude-agent-sdk` (other pins kept). The channels lock is constrained by the base lock and needed no change. | Packaging | Done |
| 12 | `node-pty` needs a native build on Linux (`npm run rebuild:native`, blocked by the proxy here). Electron `npm start`, `electron-builder --linux dir` and a live terminal were not run. | Desktop | Run on Linux, macOS and Windows machines; confirm CI `desktop-windows.yml` is green. |
| 13 | macOS and Linux desktop packages do not bundle Python (ADR 0005) and macOS builds are unsigned. | Desktop | Document in release notes; add signing and notarization later. |
| 14 | Wallet connect is unavailable in Electron by design (no extensions). The CSP (`script-src 'self'`) was not checked against a real MetaMask in a browser. | Frontend wallet | Test in Chrome with MetaMask. |
| 15 | Partly resolved: 1440x900 light and dark screenshots taken and the paper run stats overlap fixed. Not checked at 390 px. | Frontend pages | Check at 390 px. |
| 16 | `TerminalPanel` is imported both statically (`terminalAvailable`) and lazily, so Vite warns and does not split it. | Frontend | Move `terminalAvailable` into its own module. |
| 17 | Auth leftovers: the `X-Vibe-Trading-Auth` header name in `channels/websocket.py` and its locale help strings (a channel secret, not app login); `agent.authRequired` still used in `lib/api.ts` for 401/403; `useAlphaJob.ts` awaits plain strings. | Channels, frontend | Decide whether to rename the websocket header; drop `agent.authRequired` if the 401 path is removed. |
| 18 | Internal names kept for compatibility: `~/.vibe-trading`, `VIBE_TRADING_*`, keyring service, `vibe-trading.exe` lookups, Dockerfile volumes and user. | All | Leave; revisit only with a migration plan. |
| 19 | The ClawHub install command in `guides/installation.md` and `guides/mcp.md` refers to a skill published by the upstream project. | Docs | Publish a Vibe Crypto skill or remove Path D. |
| 20 | Running `claude mcp list` inside the repo shows a conflicting-scopes warning when the user scope entry (absolute path) differs from `.mcp.json` (bare command). | MCP docs | Harmless; mentioned in `CLAUDE_CODE.md` troubleshooting if it confuses users. |
| 21 | Two environment-only failures from T01: slack SDK not installed (channels tests) and a US equity `commission` rejection in `test_strategy_adaptation_workflow`. | Backend tests | Install slack extras in CI; fix or mark the adaptation test. |
| 22 | Rebrand breadth (about 3,700 hits) was handled with a script plus review; expect stragglers in rarely used strings. | All | Fix as found; `test_T01.py` guards the main ones. |
| 23 | Neither GitHub workflow has run yet. `desktop-windows.yml` adds `npm run rebuild:native` and the upload step; the rest of the packaging steps are the upstream ones. | CI | Push to `main` (or dispatch) and check the run and its `vibe-crypto-windows` artifact. |
| 24 | When a paper run refresh fails (for example no market data), the run shows state Error and its stats read n/a until the next good refresh; the last good numbers are not kept. | Paper runs | Decide whether to keep the last good summary on error. |
| 25 | The release workflow with the `.mcpb` step has not run on GitHub. The `latest/download/vibe-crypto-claude-desktop.mcpb` link and the Claude Desktop install do not work until release v0.4.0 is published; the PowerShell steps were reviewed by hand only. | CI, Claude Desktop extension | Push, dispatch the workflow, check the v0.4.0 assets and install the `.mcpb` in Claude Desktop. |
| 26 | `deploy/gcp/deploy.sh` was checked with `--dry-run`, `bash -n` and shellcheck only; the Dockerfile was not built (no Docker daemon here). No real Cloud Run deploy, bucket mount (uid and gid options) or ChatGPT connector has been tried. | Cloud Run | Deploy once to a throwaway project, connect ChatGPT, then tear it down. |
| 27 | Cloud Storage FUSE has no file locking and the server keeps MCP sessions in memory, so Cloud Run is pinned to one instance. Backtests there run without the vibe-sandbox UID drop. | Cloud Run | Check a backtest after the first deploy; do not raise max instances. |
| 28 | With the ChatGPT URL form the token is a path segment, so Cloud Run request logs (and any tunnel dashboard) contain it. The server's own access log is off when a token is set. | Remote MCP | Prefer the Authorization header where the client supports it; rotate the token if logs are shared. |
| 29 | `uvx --from git+...` tracks `main` unpinned, so a broken commit on `main` breaks every friend's next start (and the Cloud Run `--ref main` default). | Sharing | Tag releases and point the guides and plugin at a tag once stable. |
| 30 | ChatGPT menu names (Settings, Apps and Connectors, Developer mode) and plan availability change; the guide was written without a live ChatGPT account. | Docs | Walk through the ChatGPT steps once and fix the wording. |
| 31 | Broker credentials on Cloud Run have no keychain: only connector JSON files in the bucket root (confirmed for alpaca, binance, okx, dhan) and `FUTU_TRADE_PWD_MD5` are supported by the code; other connectors were not checked for JSON file support. | Brokers on Cloud Run | Confirm each connector's JSON keys, or add an env or Secret Manager credential path. |

## Task log

| Task | Title | Status | Handoff |
|---|---|---|---|
| T01 | Rebrand to Vibe Crypto | done | [T01](handoff/T01.md) |
| T02 | Remove app authentication | done | [T02](handoff/T02.md) |
| T03 | Design system and app shell | done | [T03](handoff/T03.md) |
| T04 | Paper runs backend | done (mocked engine only) | [T04](handoff/T04.md) |
| T05 | Paper trading UI | done | [T05](handoff/T05.md) |
| T06 | Claude chat panel | done (mocked SDK only) | [T06](handoff/T06.md) |
| T07 | MCP for Claude Code | done | [T07](handoff/T07.md) |
| T08 | Page redesign A | done | [T08](handoff/T08.md) |
| T09 | Page redesign B | done | [T09](handoff/T09.md) |
| T10 | Page redesign C | done | [T10](handoff/T10.md) |
| T11 | Cross-platform desktop and terminal | done in code; not run on real OSes (risk 12) | [T11](handoff/T11.md) |
| T12 | Wallet connect | done (fake provider only) | [T12](handoff/T12.md) |
| T13 | Locale sync | done | [T13](handoff/T13.md) |
| T14 | README, docs and handoff | done | [T14](handoff/T14.md) |
| T15 | Remote MCP token auth and opt-in order tools | done | [T15](handoff/T15.md) |
| T16 | uvx install check and Claude Code plugin | done | [T16](handoff/T16.md) |
| T17 | Claude Desktop extension and release | done in code; workflow not run yet (risk 25) | [T17](handoff/T17.md) |
| T18 | Share guide, ChatGPT self-hosting and Cloud Run | done; no real deploy (risk 26) | [T18](handoff/T18.md) |

## Fix log

- 2026-11-13 T01 (round 1): 3 pytest + 1 vitest failures. Root cause is
  implementation, not tests: step 2 reference sweep missed `wiki/` and
  `README_xx` mentions in AGENT_CONTRIBUTOR_GUIDE.md, CONTRIBUTING.md,
  frontend/src/i18n/index.ts, tools/ci_grep_gates.sh (gate c), and
  tools/ci_private_files_gate.py + its test; and the old editable
  `vibe-trading-ai` dist was left in .venv next to `vibe-crypto`. Fix: edit those
  files, `uv pip uninstall vibe-trading-ai`, reinstall `-e . --no-deps`.
  Tests unchanged.
- 2026-11-13 T01 (round 2): "failure" report was stale. Re-run shows pytest
  test_T01.py 114 passed / 1 skipped (favicon.svg has no <title>, expected),
  vitest T01.rebrand 72/72, electron build + test-rebrand-T01.mjs 16/16. The 3
  pytest + 1 vitest failures quoted came from the pre-round-1 author report;
  round-1 fixes (see handoff/T01.md "Round 1 fixes") are in the working tree and
  only `vibe_crypto-0.1.19` is installed in .venv. No code or test change needed.
- 2026-11-14 T08 (round 1): 2 T08 vitest failures + 1 T05 failure. Root cause
  is implementation, not tests. (a) frontend/src/pages/Compare.tsx `fmt()` and
  `diffStr()` return the escaped em dash U+2014 as the missing-value
  placeholder; the step 1 grep only looked for the literal glyph, so it slipped
  through and renders as an em dash in the table. Fix: return `"-"` (same
  placeholder RunDetail.tsx already uses). (b) T05: PaperRunDetail.tsx renders
  the Equity Stat with the default `text-2xl` value, but BRIEF table line 146
  requires the hero style `text-[32px] font-semibold tabular-nums`. Fix: wrap the
  Equity value in a `<span className="text-[32px] font-semibold tabular-nums">`.
  Tests unchanged.
- 2026-11-14 T10 (round 1): 1 vitest failure (T10.bannedPatterns "ShannonPortfolio
  has no raw <button>"). Root cause is implementation, not test: handoff/T10.md
  claims the raw button was replaced, but two inline text-link `<button>`s remain in
  components/charts/ShannonPortfolio.tsx ("use latest" date link, catalog "retry"
  link). Fix: swap both for ui `Button variant="ghost" size="sm"` (compact
  `h-auto px-0 underline` overrides), same onClick and visible text so accessible
  names used by ShannonPortfolio.test.tsx are unchanged. Tests unchanged.
- 2026-11-14 T14 (round 1): 1 pytest failure (test_T14::test_security_md_no_emoji).
  Root cause is implementation, not test: T14 rewrote SECURITY.md but left the
  upstream check mark emoji in the Supported versions table (line 7), which breaks
  the docs no-emoji rule. Fix: replace the check mark with `Yes`. Tests unchanged.
- 2026-11-14 T13 (round 1): 1 vitest failure (T13.localeSync "en.json holds the same
  English text as the component defaultValue"). Root cause is implementation, not test:
  upstream Settings.tsx already passed a short defaultValue ("Optional Gildata data
  credentials.") for the pre-existing key `settings.gildataTokenDesc`, while en.json and
  all 10 locales hold the full description; T13 kept en.json and did not align the
  component. Fix: set the defaultValue in
  frontend/src/pages/Settings.tsx:650 to the en.json text. Locales and tests unchanged.
- 2026-11-14 final integration: (a) T05 "paper equity number": the 32px hero Equity value
  overflowed into the P&L column in a 6-column stat grid (seen in the browser, not in jsdom).
  Fix: PaperRunDetail stats use a 3-column grid at md+ (Equity spans 2 on mobile), and the
  positions/trades cards get `min-w-0` so the trades table scrolls instead of pushing the page
  wider. (b) Whole pytest run: SKILL.md manifest lacked the 4 `paper_run_*` tools (count 83 to
  87); `.gitignore` runtime block lacked `/paper-runs/` and `/claude-chat/`; T02's `_serve`
  helper left the SPA mount on the shared app, which made T06's 405 check order dependent
  (helper now restores routes). (c) Risks 1 to 5, 11 resolved as listed above. (d) CI reduced
  to `test.yml` plus `desktop-windows.yml`; Docker, loader-health and docker guard test deleted.
