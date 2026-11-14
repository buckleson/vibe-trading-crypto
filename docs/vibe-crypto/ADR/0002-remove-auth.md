# ADR 0002: Remove app authentication

Status: accepted
Date: 2026-11-13

## Context

Vibe Crypto is a local, single-user desktop and localhost web app. Upstream
ships an optional shared-secret API key (`API_AUTH_KEY`), a Bearer header
injected by the frontend (`frontend/src/lib/apiAuth.ts`), single-use SSE
tickets (`POST /auth/sse-ticket`), a Settings field to paste the key, and an
Electron main process that mints a random key and injects it into every request.

Separately, `agent/src/api/security.py` defends the local API against hostile
web pages: a Host-header allow-list (DNS rebinding), a cross-site Origin check
for state-changing requests (CSRF), loopback-only peer checks, and security
headers. Those are not authentication; they stop any website the user visits
from driving a trading app on `127.0.0.1`.

## Decision

1. Remove credentials entirely: `API_AUTH_KEY`, the Bearer check, SSE tickets
   and `/auth/sse-ticket`, `frontend/src/lib/apiAuth.ts`, the Settings key
   field, and the Electron key injection.
2. Keep the FastAPI dependency names (`require_auth`,
   `require_event_stream_auth`, `require_local_or_auth`,
   `require_settings_write_auth`) so the ~20 route modules do not change. They
   now mean "local request guard": reject cross-site browser writes and
   non-loopback peers, return the loopback `Principal`. Docstrings say so.
3. Keep the DNS-rebinding middleware, the Origin check, security headers, the
   loopback bind default, and the trusted-Docker-gateway switch.
4. Keep broker/exchange credential storage (`agent/src/trading/credentials.py`,
   Electron `secure-credentials.ts`) and wallet connect. Those are data, not
   app login.
5. Remote access (LAN, phone, another machine) is out of scope and returns 403.

## Consequences

- No key to configure, paste or lose. The desktop and web UIs just work.
- A malicious website still cannot post to the local API (Origin + Host checks).
- Anyone with a shell on the machine can call the API, exactly as they could
  read the runtime files. Acceptable for a single-user local app.
- About 30 Python test files and 3 frontend test files that exercised key
  precedence and tickets are deleted or reduced to the local-guard behaviour.

## Alternatives rejected

- **Leave auth optional and off by default.** Keeps dead code, a Settings field
  and a security surface nobody uses. Rejected.
- **Rename the dependencies to `require_local`.** Touches every route module
  and test for no behaviour change. Rejected (YAGNI); docstrings carry the
  meaning.
- **Drop the Origin/Host guards too.** That would let any web page place paper
  orders or read portfolio data. Rejected.
