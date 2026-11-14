import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BackendManager } from "../dist/backend-manager.js";
import { getDesktopMessages } from "../dist/locales.js";
import { startUnrelatedPythonSentinel } from "./process-sentinel.mjs";

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logDirectory = await mkdtemp(path.join(os.tmpdir(), "vibe-trading-desktop-shell-"));
const statuses = [];
let unexpectedExit;
const unrelatedPython = await startUnrelatedPythonSentinel();

const backend = new BackendManager({
  appPath: electronRoot,
  resourcesPath: electronRoot,
  logDirectory,
  messages: getDesktopMessages("en"),
  onStatus: (message) => statuses.push(message),
  onUnexpectedExit: (message) => {
    unexpectedExit = message;
  },
});

let url;
let shutdownEvidence;
try {
  url = await backend.start();
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(`Expected a loopback backend, received ${parsed.origin}`);
  }
  const health = await fetch(new URL("health", url));
  if (!health.ok) throw new Error(`Health returned HTTP ${health.status}`);
  const sessions = await fetch(new URL("sessions", url));
  if (!sessions.ok) {
    throw new Error(`Sessions request returned HTTP ${sessions.status}`);
  }
  if (unexpectedExit) throw new Error(unexpectedExit);
} finally {
  try {
    shutdownEvidence = await backend.stopForUpdate();
    assert.equal(unrelatedPython.isAlive(), true, "Shutdown terminated an unrelated Python process");
  } finally {
    await unrelatedPython.stop();
  }
}
assert.equal(shutdownEvidence.backendExited, true);
assert.equal(shutdownEvidence.watchdogExited, true);
assert.equal(shutdownEvidence.listenerClosed, true);

console.log(JSON.stringify({
  backendOrigin: new URL(url).origin,
  statuses,
  logDirectory,
  authBoundaryVerified: true,
  shutdownVerified: true,
  unrelatedPythonPid: unrelatedPython.pid,
  unrelatedPythonSurvived: true,
}, null, 2));
