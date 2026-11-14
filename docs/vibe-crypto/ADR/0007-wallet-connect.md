# ADR 0007: Minimal read-only wallet connect

Status: accepted
Date: 2026-11-13

## Context

Crypto users want to see their wallet in the app. MetaMask (and compatible
wallets) inject an EIP-1193 provider as `window.ethereum` in the browser. The
Electron renderer has no browser extensions, so no provider exists there.

## Decision

- A `WalletButton` in the top bar, implemented with raw EIP-1193 calls
  (`eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `eth_getBalance`) in
  `frontend/src/lib/wallet.ts`. No wallet SDK dependency.
- Read-only: show short address, chain name and native balance; copy address;
  forget. No signing, no transactions, nothing sent to the backend.
- Without a provider (Electron, or a browser without MetaMask) the button opens
  a short explanation with a link to install MetaMask and, on desktop, the
  local browser URL to use instead.

## Consequences

- Zero new dependencies; nothing to keep in sync with wallet SDK releases.
- No WalletConnect QR / mobile wallets. Add only if asked.

## Alternatives rejected

- **wagmi + viem + WalletConnect.** Heavy dependency tree and a project id for
  a read-only address display. Rejected (YAGNI).
- **Trading through the wallet (DEX swaps).** Out of scope; live trading stays
  with the existing connectors.
