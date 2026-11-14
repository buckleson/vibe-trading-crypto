# Agent Contributor Guide

This guide is for AI-assisted and automation-assisted contributors working on
Vibe Crypto (https://github.com/buckleson/vibe-trading-crypto, a fork of the HKUDS project, MIT). It does not replace `CONTRIBUTING.md`, `SECURITY.md`, or the pull
request template. It makes the repo's agent-facing safety and verification
expectations explicit.

## Repository Shape

- Backend and package code live under `agent/`.
- Frontend code lives under `frontend/`.
- MCP entry point: `vibe-crypto-mcp` / `agent/mcp_server.py`.
- CLI entry point: `vibe-crypto` / `agent/cli/`.
- Fork documentation lives in `docs/vibe-crypto/`: architecture decisions in `ADR/`, one handoff note per task in `handoff/<TASK_ID>.md`, plus `HANDOFF.md` and `TODO.md`. Read the ADRs before changing auth, paper trading, Claude integration or the desktop shell.
- UI work follows `cook/BRIEF.md` (tokens, primitives in `frontend/src/components/ui/`, banned patterns).
- Broker connector, mandate, order gate, halt, and audit-ledger logic are safety
  critical even when a change appears small.
- Community commits must include the DCO `Signed-off-by:` trailer; see
  `CONTRIBUTING.md`.

Do not copy local `.env` files, token caches, broker exports, run artifacts,
private notebooks, generated reports, or local agent memory into this repository
unless they are explicitly sanitized fixtures.

## Safe Local Checks

These commands are normally safe for local validation:

```bash
git status --short --branch
git diff --check
python -m compileall -q agent/cli
python -m py_compile agent/api_server.py agent/mcp_server.py
pytest --ignore=agent/tests/e2e_backtest --ignore=agent/tests/test_e2e_harness_v2.py --tb=short -q
pytest agent/tests/test_sdk_order_gate.py agent/tests/test_mandate_enforcement.py -q
cd frontend && npm ci && npm run build
```

Use the narrowest test command that matches the changed files when a full suite
is too expensive, and state what was not run.

## High-Risk Surfaces

Get explicit maintainer or operator approval before running commands that:

- place, cancel, approve, flatten, or otherwise affect broker orders,
- authorize broker, OAuth, MCP, exchange, payment, wallet, or cloud accounts,
- write real credentials into `agent/.env`, `~/.vibe-trading/`, token caches, or
  external services,
- start externally reachable API, MCP, SSE, webhook, or dashboard servers,
- publish packages, trigger releases, or change CI secrets,
- rewrite history, force-push shared branches, delete backups, or remove
  persistent run or memory data.

Never run live trading, payment, wallet, contract, or broker-write flows as part
of routine PR validation.

## Targeted Test Hints

For general Python changes:

```bash
pytest --ignore=agent/tests/e2e_backtest --ignore=agent/tests/test_e2e_harness_v2.py --tb=short -q
```

For live/order safety changes:

```bash
pytest agent/tests/test_sdk_order_gate.py \
  agent/tests/test_mandate_enforcement.py \
  agent/tests/test_killswitch_blocks_orders.py \
  agent/tests/test_readonly_default.py -q
```

For factor-zoo changes:

```bash
pytest agent/tests/factors/test_alpha_purity.py agent/tests/factors/test_lookahead.py -q
```

For frontend changes:

```bash
cd frontend && npx vitest run src/components/layout
cd frontend && npx tsc -b && npx vite build
```

For paper runs, Claude chat and the local request guard:

```bash
pytest agent/tests/test_paper_runs.py agent/tests/test_paper_runs_routes.py \
  agent/tests/test_claude_chat.py agent/tests/test_claude_chat_routes.py \
  agent/tests/test_local_guard.py -q
```

For the desktop shell:

```bash
cd desktop/electron && npm run build && node scripts/test-backend-resolution.mjs && node scripts/test-terminal.mjs
```

Tests must not call live exchanges or the Anthropic API. Use fixtures, synthetic OHLCV and a mocked Claude Agent SDK (`src.claude_chat.service._query`).

## Documentation Rules

- Update `README.md` for user-facing CLI, Web, MCP, connector, provider, or
  safety-boundary changes.
- Record a design decision as a new file in `docs/vibe-crypto/ADR/` (context,
  decision, consequences, alternatives rejected). Write a handoff note in
  `docs/vibe-crypto/handoff/<TASK_ID>.md`: what changed, commands run with
  results, known gaps and follow-ups.
- New UI copy uses `t("ns.key", { defaultValue: "English" })`. Add the key to
  `frontend/src/i18n/locales/en.json` and every other locale in the same change.
- Docs rules: plain English, sentence case headings, no em dashes, no emoji.
- Update `CONTRIBUTING.md` when contributor workflow, DCO expectations, style
  rules, or test expectations change.
- Update `SECURITY.md` only for vulnerability reporting policy changes.
- Keep public docs in `README.md`, `guides/`, or the relevant source directory; avoid mixing generated assets or local drafts
  into public docs.
- If a change affects live/order behavior, document the safety boundary and the
  rollback or halt path.

## Security Rules

- Do not commit API keys, access tokens, OAuth caches, session cookies, private
  keys, seed phrases, broker credentials, `.env` files with real values, or
  private trading exports.
- Treat secrets as access, not text. If one appears, redact it, stop repeating
  it, and recommend rotation.
- Vibe Crypto has no app login. Do not add one, and do not expose the API
  beyond loopback. Keep the local request guard (loopback peers, Host and
  Origin checks) intact; see `docs/vibe-crypto/ADR/0002-remove-auth.md`.
- Live order placement must never be exposed through the MCP server or the
  Claude chat tools.
- External MCP servers are operator-trust surfaces. Do not allow caller-provided
  MCP command, URL, environment, or allowlist injection unless the code path
  explicitly documents and tests that opt-in.
- Broker connector writes must remain mandate-gated, kill-switch-aware,
  fail-closed, and audit-logged.
- Prefer sanitized fixtures over real financial data.

## Pull Request Expectations

Every PR should explain:

- the goal,
- the affected areas,
- what is deliberately out of scope,
- the test plan,
- any live, broker, MCP, network, secret, or deployment risk,
- rollback or close path.

Every community commit must be signed:

```bash
git commit -s -m "docs(agent): add contributor guide"
```

Do not add AI-assistant attribution trailers; follow `CONTRIBUTING.md`.

## Rollback

- Documentation-only changes can usually be reverted with `git revert <sha>`.
- Code changes touching order gates, mandate enforcement, OAuth, providers, MCP,
  settings, or external network behavior need a targeted regression test before
  merge and a clear revert path in the PR.
- If a safety regression is found after merge, prefer a small revert or
  fail-closed hotfix over broad refactors.
