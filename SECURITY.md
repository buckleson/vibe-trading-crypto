# Security Policy

## Supported Versions

| Version | Supported |
|---------|:---------:|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue.**
2. Use the [GitHub Security Advisory](https://github.com/buckleson/vibe-trading-crypto/security/advisories/new) to report privately.
3. Include steps to reproduce, potential impact, and any suggested fixes.

We will acknowledge your report within **5 business days** and work with you to resolve the issue.

## Local security model

Vibe Crypto is a local, single-user app. It has no login, API key or token.

- The API accepts requests only from this computer. Requests from other machines get a 403. Remote access (LAN, phone, another computer) is not supported.
- Host headers are checked (DNS rebinding) and cross-site browser requests that change state are rejected, so a website you visit cannot drive the local API.
- Anyone with a shell on your computer can call the API, as they could read your runtime files. Treat the machine account as the trust boundary.
- Under Docker, publish the port on `127.0.0.1` and set `VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1`.
- Live order placement is never exposed to Claude or the MCP server. Shell tools are off unless `VIBE_TRADING_ENABLE_SHELL_TOOLS=1`.
- Broker and exchange credentials are stored locally. The wallet view is read-only: it never signs or sends transactions.

The design is recorded in `docs/vibe-crypto/ADR/0002-remove-auth.md`. A bypass of the loopback, Host or Origin checks is in scope for a report.

## Scope

This policy applies to the [buckleson/vibe-trading-crypto](https://github.com/buckleson/vibe-trading-crypto) repository.

## Generated backtest code

Backtest runs may execute generated Python strategy code locally. Treat generated strategies as local code you review before running. The runner validates run directories and uses a narrow subprocess environment: it preserves OS/Python basics, proxy/certificate settings, allowed run-root configuration, and read-only market-data credentials needed by loaders, but it does not forward LLM provider keys, shell-tool opt-ins, broker trading secrets, or live/advisory toggles by default.

The backtest subprocess is still network-capable so loaders can fetch public or user-authorized market data. Do not run untrusted generated strategies in an environment that exposes sensitive files, secret-bearing proxy variables, or network services you would not trust local code to access.

## Official channels & impersonation

Vibe Crypto is an open-source finance **research** tool. The app's wallet view only reads your address, network and balance. We will **never** ask you to
"verify", connect, or sign with a crypto wallet to join our community, claim an airdrop, or
unlock features. Any such prompt is a scam.

- Vibe Crypto has no Discord server. Treat any "Vibe Crypto" Discord or community that asks for
  wallet access as an impostor.
- If a Discord or website asks you to connect/sign a wallet for "verification", do not do it.
  If you already did, move your funds to a fresh wallet and revoke approvals (e.g. via
  [revoke.cash](https://revoke.cash)).

## Disclosure

- Please do not publicly disclose the vulnerability until we have released a fix.
- We will credit reporters in the release notes (unless you prefer anonymity).
