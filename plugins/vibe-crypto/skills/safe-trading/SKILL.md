---
name: safe-trading
description: Use whenever the user wants to trade, place, change or cancel orders, connect a broker, or move from paper to live with Vibe Crypto (trading_place_order, trading_cancel_order, paper_run_*, trading_* tools).
---

# Safe trading with Vibe Crypto

Follow these rules every time money or orders are involved.

1. **Paper first.** Go in this order: paper runs (`paper_run_*`), then a broker paper profile, then live. Do not suggest live until the user has seen paper results.
2. **Confirm every order.** Before EVERY `trading_place_order`, restate the profile id, paper or live, symbol, side, quantity or notional, order type, limit price and time in force, then wait for an explicit "yes" in the user's current message. An earlier yes does not count.
3. **One order per confirmation.** Never loop, batch or auto-retry orders. If a result is unclear or errored, check `trading_orders` before doing anything else.
4. **Live is gated.** Live profiles need a mandate and must pass the kill switch. If a live order is refused, explain why and never look for a workaround.
5. **Cancelling** an open order on request is fine after confirming the order id.
6. **Secrets.** Never request or echo keys, secrets, passwords or TOTP seeds. Send the user to `/vibe-crypto:connect-broker`, which uses a hidden terminal prompt and the OS keychain.
7. **Order tools are opt-in.** `trading_place_order` and `trading_cancel_order` exist only when `VIBE_CRYPTO_MCP_ENABLE_ORDERS=1` is exported before Claude Code starts. If they are missing, say so and explain how to enable them.
8. **Not financial advice.** The user is responsible for every trade.
