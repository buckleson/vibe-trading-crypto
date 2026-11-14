# Vibe Crypto for Claude Desktop

A Claude Desktop extension (MCPB bundle) that runs the Vibe Crypto MCP server on your
own computer: market data, backtests, paper runs and 19 broker and exchange connectors.
Your keys stay on your computer.

## Install

1. Install uv (one time).
   - macOS or Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
   - Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
2. Download `vibe-crypto-claude-desktop.mcpb`:
   https://github.com/buckleson/vibe-trading-crypto/releases/latest/download/vibe-crypto-claude-desktop.mcpb
3. Double-click it, or drag it into Claude Desktop under Settings > Extensions.
4. Warm up once in a terminal so the first start in Claude does not time out (this
   downloads the server and its dependencies):

   ```
   uvx --python 3.12 --with keyring --from https://github.com/buckleson/vibe-trading-crypto/archive/refs/heads/main.zip vibe-crypto-mcp --help
   ```

## Settings

- **Python packages** (default `keyring`): comma-separated packages added next to Vibe
  Crypto, for example `keyring,alpaca-py` for Alpaca. Keep `keyring` in the list.
- **Enable order tools** (default off): lets Claude place and cancel orders. Paper
  profiles trade broker sandboxes. Live profiles still need your mandate and pass the
  kill switch, and Claude must ask before each order.

## Updates

The server is fetched from the `main` branch archive. To pull the latest code, run the
warm-up command above with `--refresh` added after `uvx`, then restart Claude Desktop.
To get a changed manifest, install the newer `.mcpb` from the releases page.

## Troubleshooting

- **uvx not found**: Claude Desktop may not have `~/.local/bin` on its PATH. Restart
  Claude Desktop after installing uv, and check `which uvx` (macOS/Linux) or
  `where uvx` (Windows).
- **First start times out**: run the warm-up command above once, then restart Claude.

## Build locally

```
npx --yes @anthropic-ai/mcpb@2.1.2 pack extensions/claude-desktop vibe-crypto-claude-desktop.mcpb
```

The bundle holds only `manifest.json`, `icon.png` and this README. The release workflow
(`.github/workflows/desktop-windows.yml`) builds and attaches it to every release. The
manifest version must equal `desktop/electron/package.json`.

More options (Claude Code plugin, Cursor, ChatGPT self-hosting):
[guides/share-with-friends.md](../../guides/share-with-friends.md).
