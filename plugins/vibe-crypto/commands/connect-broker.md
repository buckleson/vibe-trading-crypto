---
description: Connect a broker account (paper, read-only or live) to Vibe Crypto without pasting secrets into chat
argument-hint: [broker, e.g. alpaca, binance, zerodha]
---

Help the user connect this broker: $ARGUMENTS

1. Call `trading_connections` and find the profiles for this broker. If the broker is empty or unknown, list the available brokers and ask which one. Show the paper, read-only and live-trade profiles, and recommend paper or read-only first.
2. From the chosen profile's onboarding contract, name the credential fields it needs and the Python package (`dependency`).
3. NEVER ask the user to paste keys, secrets, passwords or TOTP seeds into this chat, and never echo them. Give them this command to run in their own terminal, filled in with the profile id and a short connection id of their choice:

   `uvx --python 3.12 --with keyring,<dependency> --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto connector setup <profile-id> --connection-id <short-id>`

   It prompts in a hidden terminal prompt and stores the secrets in the OS keychain.
4. Tell them to set `VIBE_CRYPTO_WITH=keyring,<dependency>` in the environment Claude Code starts from and restart Claude Code, so the MCP server has the broker package.
5. Once they confirm, call `trading_check` with the connection id and report the result. Then offer `trading_select_connection` to make it the active connection.
