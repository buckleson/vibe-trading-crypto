import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveMcpCommand } from "../dist/backend-manager.js";
import { buildMcpConfig, ClaudeTerminal, findExecutable } from "../dist/terminal-manager.js";

const root = await mkdtemp(path.join(os.tmpdir(), "vibe-terminal-"));
try {
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  const claude = path.join(bin, "claude");
  await writeFile(claude, "#!/bin/sh\n", "utf8");
  await chmod(claude, 0o755);

  assert.equal(findExecutable("claude", bin, "linux"), claude);
  assert.equal(findExecutable("claude", `${path.join(root, "nope")}${path.delimiter}${bin}`, "linux"), claude);
  assert.equal(findExecutable("claude", path.join(root, "nope"), "linux"), undefined);
  assert.equal(findExecutable("missing", bin, "linux"), undefined);

  // win32 PATHEXT simulation: the lookup uses ";" separators and appends extensions.
  const winBin = path.join(root, "win");
  await mkdir(winBin, { recursive: true });
  const claudeCmd = path.join(winBin, "claude.cmd");
  await writeFile(claudeCmd, "@echo off\r\n", "utf8");
  assert.equal(findExecutable("claude", winBin, "win32", ".COM;.EXE;.CMD"), claudeCmd);
  assert.equal(findExecutable("claude", path.join(root, "nope"), "win32", ".EXE"), undefined);

  assert.equal(buildMcpConfig(undefined), undefined);
  assert.deepEqual(buildMcpConfig({ command: "/x/vibe-crypto-mcp", args: [] }), {
    mcpServers: { "vibe-crypto": { command: "/x/vibe-crypto-mcp", args: [] } },
  });

  // Integration: resolved backend -> MCP command -> config.
  const venvBin = path.join(root, ".venv", "bin");
  await mkdir(venvBin, { recursive: true });
  await writeFile(path.join(venvBin, "vibe-crypto"), "x", "utf8");
  await writeFile(path.join(venvBin, "vibe-crypto-mcp"), "x", "utf8");
  const mcp = resolveMcpCommand(
    { executable: path.join(venvBin, "vibe-crypto"), prefixArguments: [], includeServeCommand: true },
    "linux",
  );
  assert.deepEqual(buildMcpConfig(mcp), {
    mcpServers: { "vibe-crypto": { command: path.join(venvBin, "vibe-crypto-mcp"), args: [] } },
  });

  // Missing claude: clean message, no PTY needed.
  let output = "";
  const terminal = new ClaudeTerminal();
  const result = terminal.start({
    cols: 80,
    rows: 24,
    cwd: root,
    env: { PATH: path.join(root, "nope") },
    onData: (data) => { output += data; },
    onExit: () => {},
  });
  assert.deepEqual(result, { ok: false, error: "claude-not-found" });
  assert.match(output, /npm install -g @anthropic-ai\/claude-code/u);
  assert.equal(terminal.running, false);
  terminal.write("ignored");
  terminal.resize(80, 24);
  terminal.kill();

  console.log(JSON.stringify({ findExecutable: true, buildMcpConfig: true, mcpIntegration: true, claudeMissing: true }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
