import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  backendExecutableNames,
  resolveBackend as resolveBackendForPlatform,
  resolveMcpCommand,
} from "../dist/backend-manager.js";

// Existing cases simulate Windows; POSIX cases below pass "linux" explicitly.
const resolveBackend = (opts, platform = "win32") => resolveBackendForPlatform(opts, platform);

const testRoot = await mkdtemp(path.join(os.tmpdir(), "vibe-desktop-resolution-"));

try {
  const explicit = await makeExecutable("explicit/vibe-trading.exe");
  const packagedResources = path.join(testRoot, "packaged/resources");
  const packagedPython = await makeExecutable("packaged/resources/backend/python.exe");
  const pathExecutable = await makeExecutable("path-bin/vibe-trading.exe");

  assertResolution(
    resolveBackend(options({
      appPath: path.join(testRoot, "packaged/app.asar"),
      resourcesPath: packagedResources,
      executableOverride: explicit,
      pathEnvironment: path.dirname(pathExecutable),
    })),
    explicit,
    "explicit override must take precedence",
  );

  const packagedResolution = resolveBackend(options({
    appPath: path.join(testRoot, "packaged/app.asar"),
    resourcesPath: packagedResources,
    pathEnvironment: path.dirname(pathExecutable),
  }));
  assertResolution(packagedResolution, packagedPython, "exact packaged resource must be selected");
  assert.equal(packagedResolution?.includeServeCommand, false);

  const sourceRoot = path.join(testRoot, "marked-source");
  await writeProjectMarker(sourceRoot, "vibe-crypto");
  const sourceExecutable = await makeExecutable("marked-source/.venv/Scripts/vibe-trading.exe");
  const sourceResolution = resolveBackend(options({
    appPath: path.join(sourceRoot, "desktop/electron"),
    resourcesPath: path.join(testRoot, "empty-resources"),
    moduleDirectory: path.join(sourceRoot, "desktop/electron/dist"),
    pathEnvironment: path.dirname(pathExecutable),
  }));
  assertResolution(sourceResolution, sourceExecutable, "marked source virtual environment must be selected");

  const plantedRoot = path.join(testRoot, "unmarked-ancestor");
  const plantedPython = await makeExecutable("unmarked-ancestor/backend/python.exe");
  const plantedAppPath = path.join(plantedRoot, "workspace/desktop/electron");
  const safePathExecutable = await makeExecutable("safe-path/vibe-trading.exe");
  const unmarkedResolution = resolveBackend(options({
    appPath: plantedAppPath,
    resourcesPath: path.join(plantedAppPath, "resources"),
    moduleDirectory: path.join(plantedAppPath, "dist"),
    pathEnvironment: path.dirname(safePathExecutable),
  }));
  assert.notEqual(path.resolve(unmarkedResolution?.executable ?? ""), path.resolve(plantedPython));
  assertResolution(
    unmarkedResolution,
    safePathExecutable,
    "unmarked ancestor executable must be ignored in favor of PATH",
  );

  const wrongProjectRoot = path.join(testRoot, "wrong-project");
  await writeProjectMarker(wrongProjectRoot, "another-project");
  await makeExecutable("wrong-project/.venv/Scripts/vibe-trading.exe");
  assertResolution(
    resolveBackend(options({
      appPath: path.join(wrongProjectRoot, "desktop/electron"),
      resourcesPath: path.join(testRoot, "wrong-project-resources"),
      moduleDirectory: path.join(wrongProjectRoot, "desktop/electron/dist"),
      pathEnvironment: path.dirname(pathExecutable),
    })),
    pathExecutable,
    "wrong project marker must not authorize a source virtual environment",
  );

  assertResolution(
    resolveBackend(options({
      appPath: path.join(sourceRoot, "desktop/electron"),
      resourcesPath: path.join(testRoot, "disabled-source-resources"),
      moduleDirectory: path.join(sourceRoot, "desktop/electron/dist"),
      allowSourceDiscovery: false,
      pathEnvironment: path.dirname(pathExecutable),
    })),
    pathExecutable,
    "packaged mode must not search source ancestors even when a marker exists",
  );

  // POSIX cases.
  assert.deepEqual(backendExecutableNames("linux").cli, ["vibe-crypto", "vibe-trading"]);
  assert.equal(backendExecutableNames("win32").scriptsDir, "Scripts");

  const posixPython = await makeExecutable("posix-packaged/resources/backend/bin/python3");
  const posixPackaged = resolveBackend(options({
    appPath: path.join(testRoot, "posix-packaged/app.asar"),
    resourcesPath: path.join(testRoot, "posix-packaged/resources"),
  }), "linux");
  assertResolution(posixPackaged, posixPython, "packaged backend/bin/python3 must be selected");
  assert.equal(posixPackaged?.includeServeCommand, false);
  assert.deepEqual(resolveMcpCommand(posixPackaged, "linux"), {
    command: path.resolve(posixPython),
    args: ["-c", "import mcp_server; raise SystemExit(mcp_server.main())"],
  });

  const posixSourceRoot = path.join(testRoot, "posix-source");
  await writeProjectMarker(posixSourceRoot, "vibe-crypto");
  const posixSourceCli = await makeExecutable("posix-source/.venv/bin/vibe-crypto");
  const posixSourceMcp = await makeExecutable("posix-source/.venv/bin/vibe-crypto-mcp");
  const posixSource = resolveBackend(options({
    appPath: path.join(posixSourceRoot, "desktop/electron"),
    moduleDirectory: path.join(posixSourceRoot, "desktop/electron/dist"),
  }), "linux");
  assertResolution(posixSource, posixSourceCli, "source .venv/bin/vibe-crypto must be selected");
  assert.deepEqual(resolveMcpCommand(posixSource, "linux"), {
    command: path.resolve(posixSourceMcp),
    args: [],
  });

  const posixPathCli = await makeExecutable("posix-path/vibe-crypto");
  assertResolution(
    resolveBackend(options({ pathEnvironment: path.dirname(posixPathCli) }), "linux"),
    posixPathCli,
    "PATH lookup must find vibe-crypto",
  );

  const legacyCli = await makeExecutable("posix-legacy/vibe-trading");
  const legacyMcp = await makeExecutable("posix-legacy/vibe-trading-mcp");
  const legacy = resolveBackend(options({ pathEnvironment: path.dirname(legacyCli) }), "linux");
  assertResolution(legacy, legacyCli, "legacy vibe-trading must be a fallback");
  assert.equal(resolveMcpCommand(legacy, "linux")?.command, path.resolve(legacyMcp));

  const lonelyCli = await makeExecutable("posix-lonely/vibe-crypto");
  assert.equal(
    resolveMcpCommand(resolveBackend(options({ pathEnvironment: path.dirname(lonelyCli) }), "linux"), "linux"),
    undefined,
    "no sibling mcp executable means no MCP command",
  );
  assert.equal(
    resolveBackend(options({ pathEnvironment: path.dirname(legacyCli) }), "win32"),
    undefined,
    "win32 resolution must not accept POSIX names",
  );

  console.log(JSON.stringify({
    posixCases: true,
    explicitOverride: true,
    exactPackagedResource: true,
    markedSourceRoot: true,
    unmarkedAncestorRejected: true,
    wrongMarkerRejected: true,
    packagedSourceDiscoveryDisabled: true,
  }, null, 2));
} finally {
  await rm(testRoot, { recursive: true, force: true });
}

function options(overrides) {
  return {
    appPath: path.join(testRoot, "empty-app"),
    resourcesPath: path.join(testRoot, "empty-resources"),
    moduleDirectory: path.join(testRoot, "empty-module"),
    allowSourceDiscovery: true,
    pathEnvironment: "",
    ...overrides,
  };
}

async function makeExecutable(relativePath) {
  const target = path.join(testRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "test fixture", "utf8");
  return target;
}

async function writeProjectMarker(root, projectName) {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "pyproject.toml"),
    `[project]\nname = "${projectName}"\nversion = "0.0.0"\n`,
    "utf8",
  );
}

function assertResolution(resolution, expectedExecutable, message) {
  assert.ok(resolution, message);
  assert.equal(path.resolve(resolution.executable), path.resolve(expectedExecutable), message);
}
