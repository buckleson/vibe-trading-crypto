// T02 checks for the Electron shell: no app API key is minted, injected or
// passed to the backend (ADR 0002). Offline; needs `npm run build` first
// (loads ../dist). No real backend is started: child_process.spawn is
// replaced to capture the child environment, then made to throw.
// Run: node scripts/test-T02.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const results = {};
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    results[name] = "ok";
  } catch (error) {
    failures += 1;
    results[name] = `FAIL: ${error.message}`;
  }
}

const read = (rel) => readFile(path.join(electronRoot, rel), "utf8");

await check("main.ts mints and injects no key", async () => {
  for (const rel of ["src/main.ts", "dist/main.js"]) {
    const text = await read(rel);
    for (const banned of ["apiAuthKey", "API_AUTH_KEY", "onBeforeSendHeaders", "Authorization", "Bearer"]) {
      assert.ok(!text.includes(banned), `${rel} still contains ${banned}`);
    }
    assert.ok(!/randomBytes/.test(text), `${rel} still uses randomBytes`);
  }
});

await check("main.ts still hardens the renderer session", async () => {
  const text = await read("src/main.ts");
  assert.match(text, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(text, /contextIsolation: true/);
  assert.match(text, /nodeIntegration: false/);
  assert.match(text, /sandbox: true/);
  const ctor = text.match(/new BackendManager\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
  assert.ok(ctor.length > 0, "BackendManager construction not found");
  assert.ok(!/apiAuthKey|key:/i.test(ctor), "BackendManager still receives a key");
});

await check("backend-manager option type has no apiAuthKey", async () => {
  const text = await read("src/backend-manager.ts");
  const opts = text.match(/type BackendManagerOptions = \{([\s\S]*?)\};/)?.[1] ?? "";
  assert.ok(opts.includes("credentialEnvironment"), "options block not found");
  assert.ok(!opts.includes("apiAuthKey"));
  assert.ok(!text.includes("apiAuthKey"));
  const apiKeyLines = text.split("\n").filter((l) => l.includes("API_AUTH_KEY"));
  assert.deepEqual(apiKeyLines.map((l) => l.trim()), ["delete childEnvironment.API_AUTH_KEY;"]);
});

async function captureChildEnvironment({ inherited, fromStore }) {
  const childProcess = require("node:child_process");
  const original = childProcess.spawn;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vc-t02-"));
  const fakeExe = path.join(tmp, "vibe-crypto-backend");
  await writeFile(fakeExe, "");
  const savedEnv = { ...process.env };
  let captured;
  childProcess.spawn = (command, args, options) => {
    captured = { command, args, env: { ...options.env } };
    throw new Error("spawn intercepted by test-T02");
  };
  try {
    if (inherited === undefined) delete process.env.API_AUTH_KEY;
    else process.env.API_AUTH_KEY = inherited;
    process.env.VIBE_TRADING_EXECUTABLE = fakeExe;
    const { BackendManager } = require(path.join(electronRoot, "dist/backend-manager.js"));
    const messages = new Proxy({}, { get: (_t, prop) => String(prop) });
    const manager = new BackendManager({
      appPath: tmp,
      resourcesPath: tmp,
      allowSourceDiscovery: false,
      logDirectory: path.join(tmp, "logs"),
      messages,
      credentialEnvironment: { OPENAI_API_KEY: "sk-provider", BINANCE_API_KEY: "bn", ...(fromStore === undefined ? {} : { API_AUTH_KEY: fromStore }) },
      onStatus: () => {},
      onUnexpectedExit: () => {},
    });
    await assert.rejects(manager.start(), /spawn intercepted/);
  } finally {
    childProcess.spawn = original;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  assert.ok(captured, "spawn was not reached");
  return captured;
}

for (const [label, scenario] of [
  ["no key anywhere", { inherited: undefined, fromStore: undefined }],
  ["inherited API_AUTH_KEY", { inherited: "from-parent-shell", fromStore: undefined }],
  ["empty inherited API_AUTH_KEY", { inherited: "", fromStore: undefined }],
  ["API_AUTH_KEY in credential store", { inherited: undefined, fromStore: "from-store" }],
  ["both inherited and stored", { inherited: "a", fromStore: "b" }],
]) {
  await check(`child env drops API_AUTH_KEY: ${label}`, async () => {
    const { command, args, env } = await captureChildEnvironment(scenario);
    assert.equal(command, process.execPath);
    assert.ok(String(args[0]).endsWith("backend-watchdog.js"));
    assert.ok(!("API_AUTH_KEY" in env), "API_AUTH_KEY reached the backend");
    assert.ok(!Object.values(env).includes("from-parent-shell"));
    assert.ok(!Object.values(env).includes("from-store"));
    // Broker / provider credentials are untouched.
    assert.equal(env.OPENAI_API_KEY, "sk-provider");
    assert.equal(env.BINANCE_API_KEY, "bn");
    assert.equal(env.VIBE_TRADING_DESKTOP_SECURE_CREDENTIALS, "1");
    const backendArgs = JSON.parse(Buffer.from(env.VIBE_TRADING_DESKTOP_BACKEND_ARGUMENTS, "base64url").toString("utf8"));
    const hostIndex = backendArgs.indexOf("--host");
    assert.ok(hostIndex >= 0, "no --host argument");
    assert.equal(backendArgs[hostIndex + 1], "127.0.0.1");
    assert.ok(backendArgs.includes("serve"));
  });
}

await check("scripts no longer pass or assert a key", async () => {
  for (const rel of ["scripts/smoke-lifecycle.mjs", "scripts/smoke-parent-death.mjs", "scripts/smoke-credentials.cjs",
    "scripts/test-update-safety.mjs", "scripts/test-backend-resolution.mjs"]) {
    const text = await read(rel);
    for (const banned of ["API_AUTH_KEY", "apiAuthKey", "Authorization", "Bearer"]) {
      assert.ok(!text.includes(banned), `${rel} contains ${banned}`);
    }
  }
});

await check("THREAT_MODEL describes the local guard, not a per-launch key", async () => {
  const text = await read("THREAT_MODEL.md");
  assert.match(text, /ADR 0002/);
  assert.match(text, /no login or API key/);
  assert.match(text, /loopback/i);
  assert.match(text, /Host/);
  assert.match(text, /cross-site/i);
  assert.ok(!/per-launch (?:API )?key/i.test(text), "per-launch key still described");
  assert.ok(!/Authorization header/i.test(text), "Authorization header injection still described");
  assert.ok(!/onBeforeSendHeaders/.test(text));
});

console.log(JSON.stringify(results, null, 2));
if (failures) {
  console.error(`${failures} T02 check(s) failed`);
  process.exit(1);
}
console.log("T02 desktop checks passed");
process.exit(0);
