// T01 rebrand checks for the Electron shell. Offline; needs `npm run build`
// first (imports from ../dist). Run: node scripts/test-rebrand-T01.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBackend } from "../dist/backend-manager.js";
import {
  formatDesktopMessage,
  getDesktopMessages,
  getRendererLocale,
  resolveDesktopLocale,
  supportedDesktopLocales,
} from "../dist/locales.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(here, "..");
const repoRoot = path.resolve(electronRoot, "../..");
const OLD_BRAND = /Vibe[- ]Trading/u;
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

const pkg = JSON.parse(await readFile(path.join(electronRoot, "package.json"), "utf8"));

function baseline(rel) {
  try {
    return execFileSync("git", ["show", `${process.env.T01_BASELINE_REF ?? "d19d1ac"}:${rel}`], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

await check("package identity", () => {
  assert.equal(pkg.name, "vibe-crypto-desktop");
  assert.equal(pkg.description, "Vibe Crypto desktop app");
  assert.equal(pkg.author, "Vibe Crypto contributors");
  assert.equal(pkg.build.productName, "Vibe Crypto");
  assert.equal(pkg.build.appId, "io.github.buckleson.vibecrypto");
  assert.equal(pkg.build.artifactName, "Vibe-Crypto-${version}-${os}-${arch}.${ext}");
  const licenseTargets = pkg.build.extraResources.map((r) => r.to).filter((to) => to.startsWith("licenses/")).sort();
  assert.deepEqual(licenseTargets, ["licenses/Vibe-Crypto-LICENSE.txt", "licenses/Vibe-Crypto-NOTICE.txt"]);
  for (const r of pkg.build.extraResources) {
    if (r.from.startsWith("../../")) assert.ok(existsSync(path.resolve(electronRoot, r.from)), `missing ${r.from}`);
  }
});

await check("package fields unchanged vs baseline", () => {
  const raw = baseline("desktop/electron/package.json");
  if (!raw) return;
  const base = JSON.parse(raw);
  assert.deepEqual(pkg.scripts, base.scripts);
  assert.equal(pkg.version, base.version);
  assert.equal(pkg.build.win.icon, base.build.win.icon);
});

await check("artifact name matches installer regexes and is OS-neutral", async () => {
  const sample = (os_, arch, ext) =>
    pkg.build.artifactName.replace("${version}", pkg.version).replace("${os}", os_).replace("${arch}", arch).replace("${ext}", ext);
  for (const script of ["build-review-installer.mjs", "build-signed-installer.mjs"]) {
    const src = await readFile(path.join(here, script), "utf8");
    const m = /\/(\^Vibe-[^/]+)\/u/u.exec(src);
    assert.ok(m, `${script}: installer regex not found`);
    const re = new RegExp(m[1], "u");
    assert.ok(re.test(sample("win", "x64", "exe")), `${script} misses ${sample("win", "x64", "exe")}`);
    assert.ok(!re.test(sample("win", "x64", "exe").replace("Vibe-Crypto", "Vibe-Trading")), `${script} still accepts old name`);
    assert.ok(!re.test(sample("win", "arm64", "exe")), `${script} must stay x64-only`);
  }
  for (const [o, a, e] of [["mac", "arm64", "dmg"], ["linux", "x64", "AppImage"]]) {
    const name = sample(o, a, e);
    assert.ok(!/\s/u.test(name), `artifact name has whitespace: ${name}`);
    assert.ok(name.startsWith("Vibe-Crypto-"));
  }
});

await check("desktop locales rebranded in every language", () => {
  assert.deepEqual([...supportedDesktopLocales], ["en", "zh-CN", "ja", "ko", "ar"]);
  const en = getDesktopMessages("en");
  for (const locale of supportedDesktopLocales) {
    const msgs = getDesktopMessages(locale);
    for (const [key, value] of Object.entries(msgs)) {
      assert.ok(!OLD_BRAND.test(value), `${locale}.${key} still has the old brand`);
      assert.ok(!/Unofficial|Community Build/u.test(value), `${locale}.${key} has community-build wording`);
      if (en[key].includes("Vibe Crypto")) {
        assert.ok(value.includes("Vibe Crypto"), `${locale}.${key} dropped the product name`);
      }
    }
    assert.ok(msgs.loadingTitle.includes("Vibe Crypto"), `${locale}.loadingTitle`);
    assert.ok(msgs.startupFailureTitle.includes("Vibe Crypto"), `${locale}.startupFailureTitle`);
    // Executable and env names are internal identifiers and stay until T11.
    assert.ok(msgs.backendNotFound.includes("vibe-trading.exe"), `${locale}.backendNotFound exe`);
    assert.ok(msgs.backendNotFound.includes("VIBE_TRADING_EXECUTABLE"), `${locale}.backendNotFound env`);
    assert.equal(getRendererLocale(locale).messages.loadingTitle, msgs.loadingTitle);
  }
});

await check("locale resolution edge cases", () => {
  assert.equal(resolveDesktopLocale(""), "en");
  assert.equal(resolveDesktopLocale("   "), "en");
  assert.equal(resolveDesktopLocale("ZH_cn"), "zh-CN");
  assert.equal(resolveDesktopLocale("ar-EG"), "ar");
  assert.equal(getRendererLocale("ar").direction, "rtl");
});

await check("formatted messages keep the brand and fill placeholders", () => {
  const text = formatDesktopMessage(getDesktopMessages("en").backendUnexpectedExit, { code: 3 });
  assert.equal(text, "The Vibe Crypto backend exited unexpectedly (code 3).");
  const empty = formatDesktopMessage(getDesktopMessages("en").backendUnexpectedExit, { code: null });
  assert.equal(empty, "The Vibe Crypto backend exited unexpectedly (code ).");
});

await check("main/loading built output", async () => {
  const main = await readFile(path.join(electronRoot, "dist/main.js"), "utf8");
  assert.ok(main.includes('"Vibe Crypto"'), "productName missing from dist/main.js");
  assert.ok(main.includes("persist:vibe-crypto"), "session partition not renamed");
  assert.ok(!main.includes("persist:vibe-trading"));
  assert.ok(!OLD_BRAND.test(main));
  for (const file of ["src/loading.html", "dist/loading.html"]) {
    const html = await readFile(path.join(electronRoot, file), "utf8");
    assert.match(html, /<title>Vibe Crypto<\/title>/u, file);
    assert.ok(!OLD_BRAND.test(html), file);
  }
});

await check("no old brand in desktop sources, scripts or docs", async () => {
  const offenders = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", "release", "runtime", ".cache"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|mjs|cjs|js|json|md|html|ps1)$/u.test(e.name) && !e.name.startsWith("test-rebrand-T01")) {
        if (e.name === "package-lock.json") continue;
        const text = await readFile(p, "utf8");
        if (OLD_BRAND.test(text) || /Unofficial Community Build/u.test(text) || /vibe-trading-ai/u.test(text)) {
          offenders.push(path.relative(electronRoot, p));
        }
      }
    }
  }
  await walk(electronRoot);
  assert.deepEqual(offenders, []);
});

// --- source discovery uses the new pyproject name -------------------------
const testRoot = await mkdtemp(path.join(os.tmpdir(), "vibe-crypto-t01-"));
async function makeExecutable(rel) {
  const target = path.join(testRoot, ...rel.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "fixture", "utf8");
  return target;
}
async function marker(root, body) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "pyproject.toml"), body, "utf8");
}
function resolveFrom(root, pathExe) {
  return resolveBackend({
    appPath: path.join(root, "desktop/electron"),
    resourcesPath: path.join(testRoot, `${path.basename(root)}-resources`),
    moduleDirectory: path.join(root, "desktop/electron/dist"),
    allowSourceDiscovery: true,
    pathEnvironment: path.dirname(pathExe),
  });
}

try {
  const pathExe = await makeExecutable("path-bin/vibe-trading.exe");
  const cases = [
    ["real repo pyproject", await readFile(path.join(repoRoot, "pyproject.toml"), "utf8"), true],
    ["new name", '[project]\nname = "vibe-crypto"\n', true],
    ["new name single quotes + comment", "[project]\nname = 'vibe-crypto'  # fork\n", true],
    ["old upstream name", '[project]\nname = "vibe-trading-ai"\n', false],
    ["near miss desktop pkg", '[project]\nname = "vibe-crypto-desktop"\n', false],
    ["display name", '[project]\nname = "Vibe Crypto"\n', false],
    ["name outside [project]", '[tool.other]\nname = "vibe-crypto"\n[project]\nname = "x"\n', false],
    ["empty file", "", false],
  ];
  for (const [label, body, authorized] of cases) {
    await check(`source discovery: ${label}`, async () => {
      const root = path.join(testRoot, label.replace(/\W+/gu, "-"));
      await marker(root, body);
      const venvExe = await makeExecutable(`${path.basename(root)}/.venv/Scripts/vibe-trading.exe`);
      const resolution = resolveFrom(root, pathExe);
      assert.ok(resolution, "nothing resolved");
      const expected = authorized ? venvExe : pathExe;
      assert.equal(path.resolve(resolution.executable), path.resolve(expected));
    });
  }
} finally {
  await rm(testRoot, { recursive: true, force: true });
}

console.log(JSON.stringify(results, null, 2));
if (failures) {
  console.error(`${failures} T01 desktop check(s) failed`);
  process.exit(1);
}
