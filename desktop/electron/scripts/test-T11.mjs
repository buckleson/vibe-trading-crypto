// T11 test-engineer checks: cross-platform backend/MCP resolution, Electron
// packaging config, POSIX missing-backend locale, ClaudeTerminal (with a fake
// node-pty), findExecutable, buildMcpConfig, main/preload IPC wiring and CI.
// Offline and deterministic; needs `npm run build` first (loads ../dist).
// No real PTY, Electron window or `claude` process is started.
// Run: node scripts/test-T11.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(here, "..");
const repoRoot = path.resolve(electronRoot, "..", "..");
const require = createRequire(import.meta.url);
const Module = require("node:module");

const backendManager = require("../dist/backend-manager.js");
const terminalManager = require("../dist/terminal-manager.js");
const locales = require("../dist/locales.js");
const { backendExecutableNames, resolveBackend, resolveMcpCommand } = backendManager;
const { buildMcpConfig, ClaudeTerminal, findExecutable } = terminalManager;

const results = {};
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    results[name] = "ok";
  } catch (error) {
    failures += 1;
    results[name] = `FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), "vibe-t11-"));
let counter = 0;
const fresh = async (label) => {
  counter += 1;
  const dir = path.join(root, `${counter}-${label}`);
  await mkdir(dir, { recursive: true });
  return dir;
};
const touch = async (file, mode = 0o755) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "x", "utf8");
  await chmod(file, mode);
  return file;
};
const opts = (o) => ({
  appPath: o.appPath ?? path.join(root, "no-app"),
  resourcesPath: o.resourcesPath ?? path.join(root, "no-resources"),
  allowSourceDiscovery: o.allowSourceDiscovery ?? false,
  moduleDirectory: o.moduleDirectory,
  executableOverride: o.executableOverride,
  pathEnvironment: o.pathEnvironment,
});
const PY_PREFIX = ["-c", "import api_server; raise SystemExit(api_server.serve_main())"];
const MCP_PY_ARGS = ["-c", "import mcp_server; raise SystemExit(mcp_server.main())"];

try {
  // ---------------------------------------------------------------- names
  await check("names.win32", () => {
    assert.deepEqual(backendExecutableNames("win32"), {
      cli: ["vibe-crypto.exe", "vibe-trading.exe"],
      mcp: ["vibe-crypto-mcp.exe", "vibe-trading-mcp.exe"],
      python: ["python.exe"],
      scriptsDir: "Scripts",
    });
  });
  for (const platform of ["linux", "darwin", "freebsd"]) {
    await check(`names.${platform}`, () => {
      assert.deepEqual(backendExecutableNames(platform), {
        cli: ["vibe-crypto", "vibe-trading"],
        mcp: ["vibe-crypto-mcp", "vibe-trading-mcp"],
        python: ["python3", "python"],
        scriptsDir: "bin",
      });
    });
  }
  await check("names.vibe-crypto-first", () => {
    for (const p of ["win32", "linux", "darwin"]) {
      const n = backendExecutableNames(p);
      assert.match(n.cli[0], /^vibe-crypto/u);
      assert.match(n.mcp[0], /^vibe-crypto-mcp/u);
    }
  });

  // ------------------------------------------------------- resolveBackend
  await check("resolve.override-first-on-posix", async () => {
    const d = await fresh("override");
    const override = await touch(path.join(d, "custom", "my-backend"));
    const resources = path.join(d, "res");
    await touch(path.join(resources, "backend", "bin", "python3"));
    const onPath = await touch(path.join(d, "pathbin", "vibe-crypto"));
    const r = resolveBackend(opts({ resourcesPath: resources, executableOverride: override, pathEnvironment: path.dirname(onPath) }), "linux");
    assert.equal(r.executable, path.resolve(override));
    assert.deepEqual(r.prefixArguments, []);
    assert.equal(r.includeServeCommand, true);
  });
  await check("resolve.missing-override-falls-through", async () => {
    const d = await fresh("override-missing");
    const onPath = await touch(path.join(d, "pathbin", "vibe-crypto"));
    const r = resolveBackend(opts({ executableOverride: path.join(d, "does-not-exist"), pathEnvironment: path.dirname(onPath) }), "linux");
    assert.equal(r.executable, onPath);
  });
  await check("resolve.empty-override-ignored", async () => {
    const d = await fresh("override-empty");
    const onPath = await touch(path.join(d, "pathbin", "vibe-crypto"));
    const r = resolveBackend(opts({ executableOverride: "", pathEnvironment: path.dirname(onPath) }), "linux");
    assert.equal(r.executable, onPath);
  });
  await check("resolve.packaged-posix-python3", async () => {
    const d = await fresh("pkg-py3");
    const res = path.join(d, "resources");
    const py = await touch(path.join(res, "backend", "bin", "python3"));
    await touch(path.join(res, "backend", "bin", "python"));
    const r = resolveBackend(opts({ resourcesPath: res }), "linux");
    assert.equal(r.executable, path.resolve(py));
    assert.deepEqual(r.prefixArguments, PY_PREFIX);
    assert.equal(r.includeServeCommand, false);
  });
  await check("resolve.packaged-posix-python-fallback", async () => {
    const d = await fresh("pkg-py");
    const res = path.join(d, "resources");
    const py = await touch(path.join(res, "backend", "bin", "python"));
    const r = resolveBackend(opts({ resourcesPath: res }), "darwin");
    assert.equal(r.executable, path.resolve(py));
    assert.deepEqual(r.prefixArguments, PY_PREFIX);
  });
  await check("resolve.packaged-posix-runtime-backend", async () => {
    const d = await fresh("pkg-runtime");
    const app = path.join(d, "app");
    const py = await touch(path.join(app, "runtime", "backend", "bin", "python3"));
    const r = resolveBackend(opts({ appPath: app }), "linux");
    assert.equal(r.executable, path.resolve(py));
  });
  await check("resolve.packaged-posix-ignores-windows-layout", async () => {
    const d = await fresh("pkg-cross1");
    const res = path.join(d, "resources");
    await touch(path.join(res, "backend", "python.exe"));
    await touch(path.join(res, "backend", "Scripts", "vibe-crypto.exe"));
    assert.equal(resolveBackend(opts({ resourcesPath: res }), "linux"), undefined);
  });
  await check("resolve.packaged-win32-ignores-posix-layout", async () => {
    const d = await fresh("pkg-cross2");
    const res = path.join(d, "resources");
    await touch(path.join(res, "backend", "bin", "python3"));
    await touch(path.join(res, "backend", "bin", "vibe-crypto"));
    assert.equal(resolveBackend(opts({ resourcesPath: res }), "win32"), undefined);
  });
  await check("resolve.packaged-win32-python", async () => {
    const d = await fresh("pkg-win");
    const res = path.join(d, "resources");
    const py = await touch(path.join(res, "backend", "python.exe"));
    const r = resolveBackend(opts({ resourcesPath: res }), "win32");
    assert.equal(r.executable, path.resolve(py));
    assert.deepEqual(r.prefixArguments, PY_PREFIX);
  });
  await check("resolve.packaged-posix-cli-in-backend-bin", async () => {
    const d = await fresh("pkg-cli");
    const res = path.join(d, "resources");
    const cli = await touch(path.join(res, "backend", "bin", "vibe-trading"));
    const r = resolveBackend(opts({ resourcesPath: res }), "linux");
    assert.equal(r.executable, path.resolve(cli));
    assert.deepEqual(r.prefixArguments, []);
  });
  await check("resolve.packaged-python-beats-cli", async () => {
    const d = await fresh("pkg-both");
    const res = path.join(d, "resources");
    const py = await touch(path.join(res, "backend", "bin", "python3"));
    await touch(path.join(res, "backend", "bin", "vibe-crypto"));
    assert.equal(resolveBackend(opts({ resourcesPath: res }), "linux").executable, path.resolve(py));
  });
  await check("resolve.packaged-beats-path", async () => {
    const d = await fresh("pkg-vs-path");
    const res = path.join(d, "resources");
    const py = await touch(path.join(res, "backend", "bin", "python3"));
    const onPath = await touch(path.join(d, "pathbin", "vibe-crypto"));
    const r = resolveBackend(opts({ resourcesPath: res, pathEnvironment: path.dirname(onPath) }), "linux");
    assert.equal(r.executable, path.resolve(py));
  });

  async function sourceTree(label, projectName, files) {
    const d = await fresh(label);
    await writeFile(path.join(d, "pyproject.toml"), `[build-system]\nrequires=["x"]\n\n[project]\nname = "${projectName}"\nversion = "0"\n`, "utf8");
    const app = path.join(d, "desktop", "electron");
    await mkdir(app, { recursive: true });
    const made = [];
    for (const f of files) made.push(await touch(path.join(d, ".venv", ...f.split("/"))));
    return { d, app, made };
  }
  await check("resolve.source-venv-bin-vibe-crypto", async () => {
    const { app, made } = await sourceTree("src1", "vibe-crypto", ["bin/vibe-crypto", "bin/vibe-trading"]);
    const r = resolveBackend(opts({ appPath: app, allowSourceDiscovery: true }), "linux");
    assert.equal(r.executable, made[0]);
  });
  await check("resolve.source-venv-legacy-fallback", async () => {
    const { app, made } = await sourceTree("src2", "vibe-crypto", ["bin/vibe-trading"]);
    const r = resolveBackend(opts({ appPath: app, allowSourceDiscovery: true }), "darwin");
    assert.equal(r.executable, made[0]);
  });
  await check("resolve.source-via-moduleDirectory", async () => {
    const { d, made } = await sourceTree("src3", "vibe-crypto", ["bin/vibe-crypto"]);
    const moduleDirectory = path.join(d, "desktop", "electron", "dist");
    await mkdir(moduleDirectory, { recursive: true });
    const r = resolveBackend(opts({ moduleDirectory, allowSourceDiscovery: true }), "linux");
    assert.equal(r.executable, made[0]);
  });
  await check("resolve.source-win32-uses-Scripts", async () => {
    const { app, made } = await sourceTree("src4", "vibe-crypto", ["Scripts/vibe-crypto.exe", "bin/vibe-crypto"]);
    assert.equal(resolveBackend(opts({ appPath: app, allowSourceDiscovery: true }), "win32").executable, made[0]);
    assert.equal(resolveBackend(opts({ appPath: app, allowSourceDiscovery: true }), "linux").executable, made[1]);
  });
  await check("resolve.source-disabled", async () => {
    const { app } = await sourceTree("src5", "vibe-crypto", ["bin/vibe-crypto"]);
    assert.equal(resolveBackend(opts({ appPath: app, allowSourceDiscovery: false }), "linux"), undefined);
  });
  await check("resolve.source-wrong-project-name-rejected", async () => {
    for (const name of ["vibe-trading", "vibe-crypto-extra", "other"]) {
      const { app } = await sourceTree(`src-name-${name}`, name, ["bin/vibe-crypto"]);
      assert.equal(resolveBackend(opts({ appPath: app, allowSourceDiscovery: true }), "linux"), undefined, name);
    }
  });
  await check("resolve.source-name-outside-project-section-rejected", async () => {
    const d = await fresh("src-tool-section");
    await writeFile(path.join(d, "pyproject.toml"), `[tool.x]\nname = "vibe-crypto"\n`, "utf8");
    const app = path.join(d, "app");
    await mkdir(app, { recursive: true });
    await touch(path.join(d, ".venv", "bin", "vibe-crypto"));
    assert.equal(resolveBackend(opts({ appPath: app, allowSourceDiscovery: true }), "linux"), undefined);
  });
  await check("resolve.source-name-single-quotes-and-comment", async () => {
    const d = await fresh("src-quote");
    await writeFile(path.join(d, "pyproject.toml"), `[project]\nname = 'vibe-crypto'  # renamed\n`, "utf8");
    const app = path.join(d, "app");
    await mkdir(app, { recursive: true });
    const cli = await touch(path.join(d, ".venv", "bin", "vibe-crypto"));
    assert.equal(resolveBackend(opts({ appPath: app, allowSourceDiscovery: true }), "linux").executable, cli);
  });
  await check("resolve.source-beats-path", async () => {
    const { d, app, made } = await sourceTree("src-vs-path", "vibe-crypto", ["bin/vibe-crypto"]);
    const onPath = await touch(path.join(d, "pathbin", "vibe-crypto"));
    const r = resolveBackend(opts({ appPath: app, allowSourceDiscovery: true, pathEnvironment: path.dirname(onPath) }), "linux");
    assert.equal(r.executable, made[0]);
  });

  await check("resolve.path-first-entry-wins", async () => {
    const d = await fresh("path-order");
    const a = await touch(path.join(d, "a", "vibe-trading"));
    const b = await touch(path.join(d, "b", "vibe-crypto"));
    const r = resolveBackend(opts({ pathEnvironment: [path.dirname(a), path.dirname(b)].join(path.delimiter) }), "linux");
    assert.equal(r.executable, a);
  });
  await check("resolve.path-vibe-crypto-before-legacy-same-dir", async () => {
    const d = await fresh("path-same");
    await touch(path.join(d, "bin", "vibe-trading"));
    const c = await touch(path.join(d, "bin", "vibe-crypto"));
    assert.equal(resolveBackend(opts({ pathEnvironment: path.join(d, "bin") }), "linux").executable, c);
  });
  await check("resolve.path-legacy-only", async () => {
    const d = await fresh("path-legacy");
    const t = await touch(path.join(d, "bin", "vibe-trading"));
    assert.equal(resolveBackend(opts({ pathEnvironment: path.join(d, "bin") }), "darwin").executable, t);
  });
  await check("resolve.path-skips-empty-and-quoted-entries", async () => {
    const d = await fresh("path-quoted");
    const c = await touch(path.join(d, "my bin", "vibe-crypto"));
    const env = ["", "   ", `"${path.join(d, "my bin")}"`].join(path.delimiter);
    assert.equal(resolveBackend(opts({ pathEnvironment: env }), "linux").executable, c);
  });
  await check("resolve.path-posix-ignores-exe", async () => {
    const d = await fresh("path-exe");
    await touch(path.join(d, "bin", "vibe-crypto.exe"));
    assert.equal(resolveBackend(opts({ pathEnvironment: path.join(d, "bin") }), "linux"), undefined);
  });
  await check("resolve.nothing-found", async () => {
    assert.equal(resolveBackend(opts({}), "linux"), undefined);
    assert.equal(resolveBackend(opts({ pathEnvironment: "" }), "darwin"), undefined);
    assert.equal(resolveBackend(opts({ pathEnvironment: undefined }), "win32"), undefined);
  });
  await check("resolve.default-platform-is-process-platform", async () => {
    const d = await fresh("path-default");
    const names = backendExecutableNames(process.platform);
    const c = await touch(path.join(d, "bin", names.cli[0]));
    assert.equal(resolveBackend(opts({ pathEnvironment: path.join(d, "bin") })).executable, c);
  });

  // ---------------------------------------------------- resolveMcpCommand
  await check("mcp.python-backend", () => {
    const backend = { executable: "/r/backend/bin/python3", prefixArguments: PY_PREFIX, includeServeCommand: false };
    assert.deepEqual(resolveMcpCommand(backend, "linux"), { command: "/r/backend/bin/python3", args: MCP_PY_ARGS });
    assert.deepEqual(resolveMcpCommand(backend, "win32"), { command: "/r/backend/bin/python3", args: MCP_PY_ARGS });
  });
  await check("mcp.python-backend-needs-no-files", () => {
    const backend = { executable: path.join(root, "nonexistent", "python3"), prefixArguments: ["-c", "x"], includeServeCommand: false };
    assert.equal(resolveMcpCommand(backend, "linux").command, backend.executable);
  });
  await check("mcp.cli-posix-vibe-crypto-mcp", async () => {
    const d = await fresh("mcp1");
    const cli = await touch(path.join(d, "vibe-crypto"));
    const mcp = await touch(path.join(d, "vibe-crypto-mcp"));
    await touch(path.join(d, "vibe-trading-mcp"));
    assert.deepEqual(resolveMcpCommand({ executable: cli, prefixArguments: [], includeServeCommand: true }, "linux"), { command: mcp, args: [] });
  });
  await check("mcp.cli-posix-legacy-fallback", async () => {
    const d = await fresh("mcp2");
    const cli = await touch(path.join(d, "vibe-trading"));
    const mcp = await touch(path.join(d, "vibe-trading-mcp"));
    assert.deepEqual(resolveMcpCommand({ executable: cli, prefixArguments: [], includeServeCommand: true }, "darwin"), { command: mcp, args: [] });
  });
  await check("mcp.cli-win32-exe", async () => {
    const d = await fresh("mcp3");
    const cli = await touch(path.join(d, "vibe-crypto.exe"));
    await touch(path.join(d, "vibe-crypto-mcp"));
    const mcp = await touch(path.join(d, "vibe-crypto-mcp.exe"));
    assert.deepEqual(resolveMcpCommand({ executable: cli, prefixArguments: [], includeServeCommand: true }, "win32"), { command: mcp, args: [] });
  });
  await check("mcp.cli-posix-ignores-exe", async () => {
    const d = await fresh("mcp4");
    const cli = await touch(path.join(d, "vibe-crypto"));
    await touch(path.join(d, "vibe-crypto-mcp.exe"));
    assert.equal(resolveMcpCommand({ executable: cli, prefixArguments: [], includeServeCommand: true }, "linux"), undefined);
  });
  await check("mcp.cli-without-mcp-sibling", async () => {
    const d = await fresh("mcp5");
    const cli = await touch(path.join(d, "vibe-crypto"));
    await touch(path.join(d, "other", "vibe-crypto-mcp"));
    assert.equal(resolveMcpCommand({ executable: cli, prefixArguments: [], includeServeCommand: true }, "linux"), undefined);
  });
  await check("mcp.end-to-end-from-resolveBackend", async () => {
    const d = await fresh("mcp-e2e");
    await touch(path.join(d, "bin", "vibe-crypto"));
    const mcp = await touch(path.join(d, "bin", "vibe-crypto-mcp"));
    const backend = resolveBackend(opts({ pathEnvironment: path.join(d, "bin") }), "linux");
    assert.deepEqual(buildMcpConfig(resolveMcpCommand(backend, "linux")), {
      mcpServers: { "vibe-crypto": { command: mcp, args: [] } },
    });
    const res = path.join(d, "res");
    const py = await touch(path.join(res, "backend", "bin", "python3"));
    const pyBackend = resolveBackend(opts({ resourcesPath: res }), "linux");
    assert.deepEqual(buildMcpConfig(resolveMcpCommand(pyBackend, "linux")), {
      mcpServers: { "vibe-crypto": { command: path.resolve(py), args: MCP_PY_ARGS } },
    });
  });

  // ------------------------------------------------------- findExecutable
  await check("find.posix-basic-and-order", async () => {
    const d = await fresh("find1");
    const a = await touch(path.join(d, "a", "claude"));
    const b = await touch(path.join(d, "b", "claude"));
    assert.equal(findExecutable("claude", [path.dirname(a), path.dirname(b)].join(path.delimiter), "linux"), a);
    assert.equal(findExecutable("claude", [path.dirname(b), path.dirname(a)].join(path.delimiter), "linux"), b);
  });
  await check("find.empty-path", () => {
    assert.equal(findExecutable("claude", "", "linux"), undefined);
    assert.equal(findExecutable("claude", path.delimiter + path.delimiter, "linux"), undefined);
    assert.equal(findExecutable("claude", "", "win32", ".EXE"), undefined);
  });
  await check("find.directory-named-claude-ignored", async () => {
    const d = await fresh("find-dir");
    await mkdir(path.join(d, "claude"), { recursive: true });
    assert.equal(findExecutable("claude", d, "linux"), undefined);
  });
  await check("find.quoted-and-blank-entries", async () => {
    const d = await fresh("find-quoted");
    const c = await touch(path.join(d, "with space", "claude"));
    assert.equal(findExecutable("claude", ` ${path.delimiter}"${path.dirname(c)}"`, "linux"), c);
  });
  await check("find.posix-does-not-match-extensions", async () => {
    const d = await fresh("find-ext");
    await touch(path.join(d, "claude.cmd"));
    await touch(path.join(d, "claude.exe"));
    assert.equal(findExecutable("claude", d, "linux"), undefined);
  });
  await check("find.win32-extensions", async () => {
    const d = await fresh("find-win");
    const exe = await touch(path.join(d, "exe", "claude.exe"));
    const bat = await touch(path.join(d, "bat", "claude.bat"));
    assert.equal(findExecutable("claude", path.dirname(exe), "win32", undefined), exe);
    assert.equal(findExecutable("claude", path.dirname(bat), "win32", ""), bat);
  });
  await check("find.win32-cmd-preferred-in-same-dir", async () => {
    const d = await fresh("find-win-pref");
    await touch(path.join(d, "claude.exe"));
    const cmd = await touch(path.join(d, "claude.cmd"));
    assert.equal(findExecutable("claude", d, "win32", ".EXE;.CMD"), cmd);
  });
  await check("find.win32-pathext-extra-extension", async () => {
    const d = await fresh("find-win-ps1");
    const ps1 = await touch(path.join(d, "claude.ps1"));
    assert.equal(findExecutable("claude", d, "win32", ".PS1"), ps1);
    assert.equal(findExecutable("claude", d, "win32", ".EXE"), undefined);
  });
  await check("find.win32-semicolon-separator", async () => {
    const d = await fresh("find-win-sep");
    const cmd = await touch(path.join(d, "b", "claude.cmd"));
    const env = `${path.join(d, "a")};;"${path.join(d, "b")}"`;
    assert.equal(findExecutable("claude", env, "win32", ".CMD"), cmd);
  });
  await check("find.win32-ignores-bare-name", async () => {
    const d = await fresh("find-win-bare");
    await touch(path.join(d, "claude"));
    assert.equal(findExecutable("claude", d, "win32", ".EXE"), undefined);
  });

  // ------------------------------------------------------- buildMcpConfig
  await check("mcpconfig.shape", () => {
    const cfg = buildMcpConfig({ command: "python3", args: ["-c", "x y"] });
    assert.deepEqual(cfg, { mcpServers: { "vibe-crypto": { command: "python3", args: ["-c", "x y"] } } });
    assert.deepEqual(Object.keys(cfg), ["mcpServers"]);
    assert.deepEqual(Object.keys(cfg.mcpServers), ["vibe-crypto"]);
    assert.deepEqual(JSON.parse(JSON.stringify(cfg, null, 2)), cfg);
  });
  await check("mcpconfig.undefined", () => {
    assert.equal(buildMcpConfig(undefined), undefined);
  });
  await check("mcpconfig.windows-path-roundtrip", () => {
    const cfg = buildMcpConfig({ command: "C:\\Program Files\\Vibe\\vibe-crypto-mcp.exe", args: [] });
    assert.equal(JSON.parse(JSON.stringify(cfg)).mcpServers["vibe-crypto"].command, "C:\\Program Files\\Vibe\\vibe-crypto-mcp.exe");
  });

  // ------------------------------------------- ClaudeTerminal (fake pty)
  const ptyState = { spawns: [], fail: undefined, loadError: undefined };
  function makeFakePty() {
    const child = {
      dataListeners: [], exitListeners: [], writes: [], resizes: [], killed: 0, resizeThrows: false, killThrows: false,
      onData(l) { this.dataListeners.push(l); },
      onExit(l) { this.exitListeners.push(l); },
      write(d) { this.writes.push(d); },
      resize(c, r) { if (this.resizeThrows) throw new Error("gone"); this.resizes.push([c, r]); },
      kill() { this.killed += 1; if (this.killThrows) throw new Error("already dead"); },
      emitData(d) { for (const l of this.dataListeners) l(d); },
      emitExit(code) { for (const l of this.exitListeners) l({ exitCode: code }); },
    };
    return child;
  }
  const fakePtyModule = {
    spawn(file, args, options) {
      if (ptyState.fail) throw ptyState.fail;
      const child = makeFakePty();
      ptyState.spawns.push({ file, args, options, child });
      return child;
    },
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "node-pty") {
      if (ptyState.loadError) throw ptyState.loadError;
      return fakePtyModule;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const claudeDir = await fresh("claude-bin");
  const claudeName = process.platform === "win32" ? "claude.exe" : "claude";
  const claudePath = await touch(path.join(claudeDir, claudeName));
  const baseEnv = () => ({ PATH: claudeDir, HOME: "/h", ELECTRON_RUN_AS_NODE: "1", TERM: "dumb", KEEP: "yes" });
  const startOpts = (o = {}) => {
    const sink = { data: "", exits: [] };
    const options = {
      cols: 80, rows: 24, cwd: root, env: baseEnv(),
      onData: (d) => { sink.data += d; },
      onExit: (c) => { sink.exits.push(c); },
      ...o,
    };
    return { options, sink };
  };
  const reset = () => { ptyState.spawns.length = 0; ptyState.fail = undefined; ptyState.loadError = undefined; };

  try {
    await check("pty.spawn-with-mcp-config", () => {
      reset();
      const t = new ClaudeTerminal();
      assert.equal(t.running, false);
      const { options } = startOpts({ mcpConfigPath: "/u/claude-mcp.json" });
      assert.deepEqual(t.start(options), { ok: true });
      assert.equal(t.running, true);
      assert.equal(ptyState.spawns.length, 1);
      const s = ptyState.spawns[0];
      assert.equal(s.file, claudePath);
      assert.deepEqual(s.args, ["--mcp-config", "/u/claude-mcp.json"]);
      assert.equal(s.options.name, "xterm-256color");
      assert.equal(s.options.cols, 80);
      assert.equal(s.options.rows, 24);
      assert.equal(s.options.cwd, root);
      t.kill();
    });
    await check("pty.spawn-without-mcp-config", () => {
      reset();
      const t = new ClaudeTerminal();
      t.start(startOpts().options);
      assert.deepEqual(ptyState.spawns[0].args, []);
      t.kill();
      reset();
      t.start(startOpts({ mcpConfigPath: "" }).options);
      assert.deepEqual(ptyState.spawns[0].args, [], "empty mcpConfigPath means no flag");
      t.kill();
    });
    await check("pty.env-sanitised-and-not-mutated", () => {
      reset();
      const t = new ClaudeTerminal();
      const { options } = startOpts();
      const envBefore = { ...options.env };
      t.start(options);
      const env = ptyState.spawns[0].options.env;
      assert.equal(env.TERM, "xterm-256color");
      assert.equal(env.COLORTERM, "truecolor");
      assert.equal("ELECTRON_RUN_AS_NODE" in env, false);
      assert.equal(env.KEEP, "yes");
      assert.equal(env.HOME, "/h");
      assert.deepEqual(options.env, envBefore, "caller env must not be mutated");
      t.kill();
    });
    await check("pty.clamps-size", () => {
      const cases = [[1, 1, 2, 2], [0, -5, 2, 2], [1000, 9999, 500, 500], [80.9, 24.2, 80, 24], [2, 500, 2, 500]];
      for (const [c, r, ec, er] of cases) {
        reset();
        const t = new ClaudeTerminal();
        t.start(startOpts({ cols: c, rows: r }).options);
        assert.equal(ptyState.spawns[0].options.cols, ec, `cols ${c}`);
        assert.equal(ptyState.spawns[0].options.rows, er, `rows ${r}`);
        t.kill();
      }
    });
    await check("pty.second-start-is-noop", () => {
      reset();
      const t = new ClaudeTerminal();
      t.start(startOpts().options);
      assert.deepEqual(t.start(startOpts().options), { ok: true });
      assert.equal(ptyState.spawns.length, 1);
      t.kill();
    });
    await check("pty.data-write-resize", () => {
      reset();
      const t = new ClaudeTerminal();
      const { options, sink } = startOpts();
      t.start(options);
      const child = ptyState.spawns[0].child;
      child.emitData("hello ");
      child.emitData("world");
      assert.equal(sink.data, "hello world");
      t.write("ls\r");
      t.write("");
      assert.deepEqual(child.writes, ["ls\r", ""]);
      t.resize(120, 40);
      t.resize(1, 99999);
      assert.deepEqual(child.resizes, [[120, 40], [2, 500]]);
      child.resizeThrows = true;
      assert.doesNotThrow(() => t.resize(100, 30));
      t.kill();
    });
    await check("pty.ops-when-not-running-are-safe", () => {
      const t = new ClaudeTerminal();
      assert.doesNotThrow(() => { t.write("x"); t.resize(10, 10); t.kill(); t.kill(); });
      assert.equal(t.running, false);
    });
    await check("pty.kill", () => {
      reset();
      const t = new ClaudeTerminal();
      t.start(startOpts().options);
      const child = ptyState.spawns[0].child;
      t.kill();
      assert.equal(child.killed, 1);
      assert.equal(t.running, false);
      t.write("after");
      assert.deepEqual(child.writes, [], "no writes after kill");
    });
    await check("pty.kill-throwing-is-swallowed", () => {
      reset();
      const t = new ClaudeTerminal();
      t.start(startOpts().options);
      ptyState.spawns[0].child.killThrows = true;
      assert.doesNotThrow(() => t.kill());
      assert.equal(t.running, false);
    });
    await check("pty.exit-reports-code-and-allows-restart", () => {
      reset();
      const t = new ClaudeTerminal();
      const { options, sink } = startOpts();
      t.start(options);
      ptyState.spawns[0].child.emitExit(3);
      assert.deepEqual(sink.exits, [3]);
      assert.equal(t.running, false);
      assert.deepEqual(t.start(options), { ok: true });
      assert.equal(ptyState.spawns.length, 2);
      t.kill();
    });
    await check("pty.stale-exit-does-not-clear-new-session", () => {
      reset();
      const t = new ClaudeTerminal();
      const { options } = startOpts();
      t.start(options);
      const first = ptyState.spawns[0].child;
      t.kill();
      t.start(options);
      first.emitExit(0);
      assert.equal(t.running, true, "old PTY exit must not mark the new one stopped");
      t.write("x");
      assert.deepEqual(ptyState.spawns[1].child.writes, ["x"]);
      t.kill();
    });
    await check("pty.spawn-failure", () => {
      reset();
      ptyState.fail = new Error("posix_spawnp failed");
      const t = new ClaudeTerminal();
      const { options, sink } = startOpts();
      const result = t.start(options);
      assert.equal(result.ok, false);
      assert.match(result.error, /posix_spawnp failed/u);
      assert.match(sink.data, /Could not start Claude Code: posix_spawnp failed/u);
      assert.equal(t.running, false);
    });
    await check("pty.node-pty-load-failure", () => {
      reset();
      ptyState.loadError = new Error("NODE_MODULE_VERSION mismatch");
      const t = new ClaudeTerminal();
      const { options, sink } = startOpts();
      const result = t.start(options);
      assert.equal(result.ok, false);
      assert.match(result.error, /^node-pty-unavailable: NODE_MODULE_VERSION mismatch/u);
      assert.match(sink.data, /node-pty/u);
      assert.equal(t.running, false);
    });
    await check("pty.claude-not-found-message-exact", () => {
      reset();
      const t = new ClaudeTerminal();
      const { options, sink } = startOpts({ env: { PATH: path.join(root, "empty-nowhere") } });
      assert.deepEqual(t.start(options), { ok: false, error: "claude-not-found" });
      assert.equal(sink.data,
        "Claude Code CLI was not found on PATH.\r\nInstall it with: npm install -g @anthropic-ai/claude-code\r\nThen press Restart.\r\n");
      assert.equal(ptyState.spawns.length, 0, "no PTY when claude is missing");
      assert.equal(t.running, false);
    });
    await check("pty.env-without-PATH-falls-back-to-process-PATH", () => {
      reset();
      const saved = process.env.PATH;
      process.env.PATH = claudeDir;
      try {
        const t = new ClaudeTerminal();
        const { options } = startOpts({ env: { HOME: "/h" } });
        assert.deepEqual(t.start(options), { ok: true });
        assert.equal(ptyState.spawns[0].file, claudePath);
        t.kill();
      } finally {
        process.env.PATH = saved;
      }
    });
  } finally {
    Module._load = originalLoad;
  }

  // ------------------------------------------------------------- locales
  const POSIX_TEXT = "Vibe Crypto needs its Python backend. In the project folder run: pip install -e . (or uv pip install -e .), then restart. You can also set VIBE_TRADING_EXECUTABLE to the vibe-crypto command.";
  await check("locales.backendMissingPosix-in-every-locale", () => {
    assert.equal(locales.getDesktopMessages("en").backendMissingPosix, POSIX_TEXT);
    for (const l of locales.supportedDesktopLocales) {
      const m = locales.getDesktopMessages(l).backendMissingPosix;
      assert.equal(typeof m, "string", l);
      assert.ok(m.includes("pip install -e .") && m.includes("VIBE_TRADING_EXECUTABLE"), l);
      assert.ok(!m.includes("\u2014"), `${l} contains an em dash`);
    }
  });

  // ------------------------------------------------- static source checks
  const src = (p) => readFile(path.join(electronRoot, p), "utf8");
  const mainTs = await src("src/main.ts");
  const preloadTs = await src("src/preload.ts");
  const terminalTs = await src("src/terminal-manager.ts");

  await check("main.terminal-ipc-validated", () => {
    for (const channel of ["terminal:start", "terminal:write", "terminal:resize", "terminal:kill"]) {
      const at = mainTs.indexOf(`"${channel}"`);
      assert.ok(at > 0, `${channel} registered`);
      const body = mainTs.slice(at, at + 400);
      assert.match(body, /assertMainWindowSender\(event\.sender\)/u, `${channel} checks sender`);
    }
    assert.match(mainTs, /ipcMain\.handle\("terminal:start"/u);
    assert.match(mainTs, /ipcMain\.on\("terminal:write"/u);
    assert.match(mainTs, /ipcMain\.on\("terminal:resize"/u);
    assert.match(mainTs, /ipcMain\.handle\("terminal:kill"/u);
    assert.match(mainTs, /65_?536/u, "write payload size cap");
    assert.match(mainTs, /Number\.isInteger/u, "dimensions must be integers");
  });
  await check("main.terminal-forwarding-and-config", () => {
    assert.match(mainTs, /webContents\.send\("terminal:data", chunk\)/u);
    assert.match(mainTs, /webContents\.send\("terminal:exit", \{ exitCode \}\)/u);
    assert.match(mainTs, /"claude-mcp\.json"/u);
    assert.match(mainTs, /app\.getPath\("userData"\)/u);
    assert.match(mainTs, /JSON\.stringify\(config, null, 2\)/u);
    assert.match(mainTs, /resolveMcpCommand/u);
    assert.match(mainTs, /cwd: os\.homedir\(\)/u);
    assert.match(mainTs, /backgroundColor: "#0E1016"/u);
    assert.match(mainTs, /backendMissingPosix/u);
  });
  await check("main.pty-killed-on-close-and-shutdown", () => {
    const closeAt = mainTs.indexOf('mainWindow.on("close"');
    assert.ok(closeAt > 0);
    assert.match(mainTs.slice(closeAt, closeAt + 200), /claudeTerminal\.kill\(\)/u);
    const shutdownAt = mainTs.indexOf("async function shutdownAndQuit");
    assert.ok(shutdownAt > 0);
    assert.match(mainTs.slice(shutdownAt, shutdownAt + 300), /claudeTerminal\.kill\(\)/u);
  });
  await check("preload.terminal-api-narrow", () => {
    for (const ch of ["terminal:start", "terminal:write", "terminal:resize", "terminal:kill", "terminal:data", "terminal:exit"]) {
      assert.ok(preloadTs.includes(`"${ch}"`), ch);
    }
    assert.match(preloadTs, /removeListener\("terminal:data", listener\)/u);
    assert.match(preloadTs, /removeListener\("terminal:exit", listener\)/u);
    assert.doesNotMatch(preloadTs, /removeAllListeners/u);
    assert.doesNotMatch(preloadTs, /exposeInMainWorld\([^)]*ipcRenderer\s*\)/u, "raw ipcRenderer must not be exposed");
  });
  await check("terminal-manager.node-pty-lazy", () => {
    assert.doesNotMatch(terminalTs, /^import[^\n]*node-pty/mu, "node-pty must not be a top-level import");
    assert.match(terminalTs, /require\("node-pty"\)/u);
    assert.match(terminalTs, /ComSpec/u);
    assert.match(terminalTs, /"\/d", "\/s", "\/c"/u);
  });
  await check("backend-manager.posix-group-kill-and-guarded-taskkill", async () => {
    const bm = await src("src/backend-manager.ts");
    assert.match(bm, /detached: process\.platform !== "win32"/u);
    assert.match(bm, /process\.kill\(-pid, "SIGTERM"\)/u);
    const taskkillAt = bm.indexOf('"taskkill.exe"');
    const guardAt = bm.lastIndexOf('process.platform !== "win32"', taskkillAt);
    assert.ok(taskkillAt > 0 && guardAt > 0 && taskkillAt - guardAt < 800, "taskkill guarded by a win32 check");
  });

  // ------------------------------------------------ package.json / builder
  const pkg = JSON.parse(await src("package.json"));
  await check("package.scripts", () => {
    const s = pkg.scripts;
    assert.equal(s.start, "npm run build && electron .");
    assert.doesNotMatch(s.start, /prepare:electron/u);
    assert.equal(s["prepare:electron"], "node scripts/prepare-electron.mjs");
    assert.equal(s["pack:mac"], "npm run build && npm run prepare:electron && electron-builder --publish never --mac dir");
    assert.equal(s["pack:linux"], "npm run build && npm run prepare:electron && electron-builder --publish never --linux dir");
    assert.match(s["dist:mac"], /--mac dmg zip$/u);
    assert.match(s["dist:linux"], /--linux AppImage deb$/u);
    assert.equal(s["rebuild:native"], "electron-rebuild -f -w node-pty");
    assert.equal(s["test:terminal"], "npm run build && node scripts/test-terminal.mjs");
    assert.ok(s["pack:win"], "pack:win kept");
    assert.ok(s["installer:win:review"], "Windows installer kept");
  });
  await check("package.deps", () => {
    assert.match(pkg.dependencies?.["node-pty"] ?? "", /^\^1\./u);
    assert.ok(pkg.devDependencies?.["@electron/rebuild"], "@electron/rebuild dev dep");
    assert.equal(pkg.devDependencies?.["node-pty"], undefined);
  });
  await check("package.builder-config", () => {
    const b = pkg.build;
    const globalFroms = b.extraResources.map((r) => r.from);
    assert.ok(!globalFroms.includes("runtime/backend"), "runtime/backend must not be global");
    assert.ok(globalFroms.includes("../../LICENSE") && globalFroms.includes("../../NOTICE"), "licences stay global");
    assert.deepEqual(b.win.extraResources, [{ from: "runtime/backend", to: "backend" }]);
    assert.deepEqual(b.mac, { target: ["dmg", "zip"], category: "public.app-category.finance", icon: "../../assets/icon.png" });
    assert.deepEqual(b.linux, {
      target: ["AppImage", "deb"], category: "Finance", icon: "../../assets/icon.png", maintainer: "Vibe Crypto contributors",
    });
    assert.deepEqual(b.asarUnpack, ["node_modules/node-pty/**"]);
    assert.deepEqual(b.electronLanguages, ["ar", "en-GB", "en-US", "ja", "ko", "zh-CN"]);
    assert.ok(existsSync(path.resolve(electronRoot, "../../assets/icon.png")), "icon exists");
  });
  await check("prepare-electron.platform-aware", async () => {
    const p = await src("scripts/prepare-electron.mjs");
    assert.match(p, /process\.platform/u);
    assert.match(p, /process\.arch/u);
    assert.match(p, /electron-v\$\{version\}-\$\{PLATFORM\}-\$\{ARCH\}\.zip/u);
    assert.match(p, /"electron\.exe"/u);
    assert.match(p, /"Electron\.app\/Contents\/MacOS\/Electron"/u);
    assert.match(p, /checksums\.json/u);
    const checksums = JSON.parse(await readFile(path.join(electronRoot, "node_modules", "electron", "checksums.json"), "utf8"));
    const version = JSON.parse(await readFile(path.join(electronRoot, "node_modules", "electron", "package.json"), "utf8")).version;
    for (const name of ["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"]) {
      assert.ok(checksums[`electron-v${version}-${name}.zip`], `checksum for ${name}`);
    }
  });

  // ------------------------------------------------------------ CI / docs
  await check("ci.desktop-workflow", async () => {
    // Windows is the only build target in CI; platform-neutral checks run on Linux in test.yml.
    const wf = await readFile(path.join(repoRoot, ".github", "workflows", "desktop-windows.yml"), "utf8");
    assert.ok(!existsSync(path.join(repoRoot, ".github", "workflows", "desktop.yml")), "matrix workflow removed");
    assert.match(wf, /node-version: "22"/u);
    for (const cmd of ["npm ci", "npm run build", "npm run rebuild:native", "node scripts/test-backend-resolution.mjs", "node scripts/test-locales.mjs", "node scripts/test-terminal.mjs"]) {
      assert.ok(wf.includes(cmd), cmd);
    }
    assert.match(wf, /\n {2}package:\n/u, "Windows packaging job");
    assert.match(wf, /runs-on: windows-/u);
    assert.doesNotMatch(wf, /runs-on: (ubuntu|macos)-/u);
    assert.match(wf, /installer:win:review/u);
    assert.match(wf, /actions\/upload-artifact@[0-9a-f]{40}/u);
    const tests = await readFile(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf8");
    for (const cmd of ["node scripts/test-backend-resolution.mjs", "node scripts/test-locales.mjs", "node scripts/test-terminal.mjs"]) {
      assert.ok(tests.includes(cmd), `test.yml runs ${cmd}`);
    }
  });
  await check("docs.readme", async () => {
    const r = await readFile(path.join(electronRoot, "README.md"), "utf8");
    for (const needle of ["pip install -e .", "rebuild:native", "claude-mcp.json", "pack:linux", "pack:mac"]) {
      assert.ok(r.includes(needle), `README mentions ${needle}`);
    }
    assert.match(r, /macOS/u);
    assert.match(r, /Linux/u);
    assert.match(r, /Windows/u);
    assert.match(r, /unsigned/iu);
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ results, failures }, null, 2));
process.exitCode = failures === 0 ? 0 : 1;
