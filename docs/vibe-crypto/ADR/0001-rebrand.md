# ADR 0001: Rebrand to Vibe Crypto

Status: accepted
Date: 2026-11-13

## Context

This repository is a fork of HKUDS/Vibe-Trading (MIT). The fork lives at
`buckleson/vibe-trading-crypto` and ships as **Vibe Crypto**. The product keeps
every market the upstream supports (crypto, US/HK/CN equities, futures, forex,
options); the name changes, the scope does not.

The upstream brand appears about 3,700 times: product name in UI copy, i18n
values in 11 locales, docs, the CLI banner, package metadata, the Electron app
id, the MCP server name, GitHub URLs, docs-site links (`vibetrading.wiki`), and
internal identifiers (`VIBE_TRADING_*` env vars, `~/.vibe-trading` runtime
root, Python identifiers, localStorage keys).

## Decision

1. Rename every **user-visible** name in one pass (wave 1, a single task):
   - Product name: `Vibe Crypto` (no hyphen, sentence case).
   - Python distribution: `vibe-crypto`. CLI entry points: `vibe-crypto` and
     `vibe-crypto-mcp`. The old `vibe-trading` and `vibe-trading-mcp` entry
     points stay as aliases so existing scripts and the desktop resolver keep
     working until wave 4.
   - Frontend package: `vibe-crypto-frontend`. HTML title: `Vibe Crypto`.
   - Electron: package `vibe-crypto-desktop`, productName `Vibe Crypto`,
     appId `io.github.buckleson.vibecrypto`. "Unofficial Community Build"
     wording is dropped.
   - MCP server display name: `Vibe Crypto`; the name users register in
     Claude Code is `vibe-crypto`.
   - GitHub links point to `https://github.com/buckleson/vibe-trading-crypto`.
   - In-app docs links point to the repo README until we have our own docs.
2. Keep **internal identifiers** unchanged: `VIBE_TRADING_*` env vars, the
   `~/.vibe-trading` runtime root, Python module paths, storage keys, header
   names, event names, MCP tool names.
3. Keep upstream attribution: `LICENSE` keeps the original MIT notice and adds a
   fork copyright line; `NOTICE` keeps every upstream line and adds a Vibe
   Crypto header; the README has a Credits section linking HKUDS/Vibe-Trading.
4. Remove upstream-only distribution and docs surfaces we will not operate:
   translated `README_xx.md` files and `assets/features/<lang>/`, the `wiki/`
   docs site with `wiki.yml` / `wiki-deploy.yml` workflows, and `zimaos/`.
   `CHANGELOG.md` keeps its upstream history untouched under a new top section.

## Consequences

- Users see one consistent name everywhere they look.
- Existing env files, runtime data and scripts keep working; no migration code.
- Some internal names still say "vibe trading". That is invisible and harmless.
- The UI stays localized in 11 languages; only the README is English-only.

## Alternatives rejected

- **Rename env vars and the runtime root.** Hundreds of call sites and tests,
  a data migration, and zero user value. Rejected (YAGNI).
- **Keep translated READMEs and the wiki.** They describe the upstream product
  and would need ongoing translation and hosting. Rejected; credits link to the
  upstream docs instead.
- **Rename gradually per feature task.** Every later task would touch shared
  files; one mechanical pass before everything else avoids merge conflicts.
