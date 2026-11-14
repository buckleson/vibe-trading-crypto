// T02: app authentication removed (ADR 0002). Offline, deterministic checks:
// no API key, Authorization header or SSE ticket is sent by the API client or
// the SSE hook, the Settings page has no app key field, and the Vite dev
// proxy no longer forwards /auth. fetch and EventSource are mocked.
import fs from "node:fs";
import path from "node:path";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSSE } from "@/hooks/useSSE";

const SRC = path.resolve(__dirname, "../..");
const FRONTEND = path.resolve(SRC, "..");
const LEGACY_STORAGE_KEY = "vibe_trading_api_auth_key";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "locales") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

// Files that must mention the removed names in order to test their absence.
const SELF_OR_LEGACY = new Set([
  path.join(SRC, "__tests__/vibe-crypto/T02.auth-removal.test.tsx"),
  path.join(SRC, "__tests__/vibe-crypto/T01.rebrand.test.tsx"),
]);

function storageWith(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries));
  return {
    getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn((k: string) => void store.delete(k)),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(() => null),
    get length() {
      return store.size;
    },
  };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (init?.headers) new Headers(init.headers).forEach((v, k) => (out[k] = v));
  return out;
}

async function loadApi() {
  vi.resetModules();
  return import("@/lib/api");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ── 8. apiAuth module is gone ─────────────────────────────────────────────

describe("apiAuth module removal", () => {
  it("deletes lib/apiAuth.ts and its test", () => {
    expect(fs.existsSync(path.join(SRC, "lib/apiAuth.ts"))).toBe(false);
    expect(fs.existsSync(path.join(SRC, "lib/__tests__/apiAuth.test.ts"))).toBe(false);
  });

  it("cannot be imported any more", async () => {
    await expect(import(/* @vite-ignore */ path.join(SRC, "lib/apiAuth.ts"))).rejects.toBeTruthy();
  });

  it("no production source references the removed auth helpers", () => {
    const pattern = /apiAuth|sse-ticket|withAuthTicket|getApiAuthKey|setApiAuthKey|vibe_trading_api_auth_key|authHeaders/;
    const offenders = walk(SRC)
      .filter((f) => !SELF_OR_LEGACY.has(f) && !f.includes(`${path.sep}__tests__${path.sep}`))
      .filter((f) => pattern.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(FRONTEND, f));
    expect(offenders).toEqual([]);
  });

  it("no production source builds a Bearer Authorization header", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
      .filter((f) => /Bearer\s|["']Authorization["']/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(FRONTEND, f));
    expect(offenders).toEqual([]);
  });
});

// ── 8. api.ts sends no credentials ───────────────────────────────────────

describe("api.ts request helper without auth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // A key left over from an older build must be ignored.
    vi.stubGlobal("localStorage", storageWith({ [LEGACY_STORAGE_KEY]: "stale-key", "vibe-trading-lang": "en" }));
    vi.stubGlobal("sessionStorage", storageWith({ [LEGACY_STORAGE_KEY]: "stale-key" }));
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GET sends only Content-Type, never Authorization", async () => {
    const { request } = await loadApi();
    await expect(request("/skills")).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/skills");
    expect(headersOf(init)).toEqual({ "content-type": "application/json" });
  });

  it("POST keeps Content-Type and the body, still no Authorization", async () => {
    const { request } = await loadApi();
    await request("/api/paper-accounts", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(headersOf(init)).toEqual({ "content-type": "application/json" });
  });

  it("merges caller headers (object, Headers, tuple array) without adding auth", async () => {
    const { request } = await loadApi();
    await request("/a", { headers: { "X-Trace": "1" } });
    await request("/b", { headers: new Headers({ "X-Trace": "2" }) });
    await request("/c", { headers: [["X-Trace", "3"]] });
    const seen = fetchMock.mock.calls.map(([, init]) => headersOf(init));
    expect(seen).toEqual([
      { "content-type": "application/json", "x-trace": "1" },
      { "content-type": "application/json", "x-trace": "2" },
      { "content-type": "application/json", "x-trace": "3" },
    ]);
  });

  it("keeps the pre-T02 Content-Type merge unchanged (default key plus caller key)", async () => {
    // Pre-existing behaviour, unchanged by T02: the default "Content-Type" and
    // the caller's lower-cased key are both kept in the plain object.
    const { request } = await loadApi();
    await request("/a", { headers: { "Content-Type": "text/plain" } });
    const raw = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(raw).toEqual({ "Content-Type": "application/json", "content-type": "text/plain" });
  });

  it("passes through a caller-supplied Authorization (it does not mint one)", async () => {
    // The helper must neither add nor strip headers it was given; only that
    // it never invents credentials is part of ADR 0002.
    const { request } = await loadApi();
    await request("/a", { headers: { Authorization: "Bearer caller" } });
    expect(headersOf(fetchMock.mock.calls[0][1]).authorization).toBe("Bearer caller");
  });

  it("does not read the legacy key from storage", async () => {
    const ls = storageWith({ [LEGACY_STORAGE_KEY]: "stale-key" });
    vi.stubGlobal("localStorage", ls);
    const { request } = await loadApi();
    await request("/a");
    expect(ls.getItem).not.toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
  });

  it("returns {} for an empty body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const { request } = await loadApi();
    await expect(request("/empty")).resolves.toEqual({});
  });

  it("uploadFile sends multipart without Authorization or Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "ok", file_path: "/x", filename: "a.csv" }));
    const { api } = await loadApi();
    await api.uploadFile(new File(["a,b\n1,2"], "a.csv", { type: "text/csv" }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(headersOf(init)).toEqual({});
  });

  it("downloadGeneratedReport fetches with no headers", async () => {
    fetchMock.mockResolvedValueOnce(new Response("%PDF", { headers: { "content-type": "application/pdf" } }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:x");
      static revokeObjectURL = vi.fn();
    });
    const { downloadGeneratedReport } = await loadApi();
    await downloadGeneratedReport("r/1", "r.pdf");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/reports/r%2F1");
    expect(headersOf(init)).toEqual({});
  });

  it.each([401, 403])("maps HTTP %s to an auth-required ApiError (still handled)", async (status) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Vibe Crypto only accepts requests from this computer" }, status));
    const { request, isAuthRequiredError, ApiError } = await loadApi();
    const err = await request("/skills").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(status);
    expect(isAuthRequiredError(err)).toBe(true);
  });

  it("does not treat other errors as auth-required", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "nope" }, 404));
    const { request, isAuthRequiredError } = await loadApi();
    const err = await request("/x").catch((e) => e);
    expect(err.status).toBe(404);
    expect(isAuthRequiredError(err)).toBe(false);
    expect(isAuthRequiredError(new Error("x"))).toBe(false);
    expect(isAuthRequiredError(null)).toBe(false);
  });

  it("never calls an /auth endpoint", async () => {
    const { request } = await loadApi();
    await request("/skills");
    await request("/api/paper-accounts", { method: "POST", body: "{}" });
    expect(fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("/auth"))).toEqual([]);
  });
});

// ── 8/9. stream URL helpers are plain strings ───────────────────────────────

describe("SSE URL helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("return synchronous strings without ticket or api_key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await loadApi();
    const urls = [
      api.swarmSseUrl("run-1"),
      api.alphaBenchStreamUrl("job-1"),
      api.alphaCompareStreamUrl("job-1"),
    ];
    for (const u of urls) {
      expect(typeof u).toBe("string");
      expect(u).not.toMatch(/ticket=|api_key=|token=/);
    }
    expect(urls).toEqual([
      "/swarm/runs/run-1/events",
      "/alpha/bench/job-1/stream",
      "/alpha/compare/job-1/stream",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes job ids with special characters", async () => {
    const { api } = await loadApi();
    expect(api.alphaBenchStreamUrl("a/b?c")).toBe("/alpha/bench/a%2Fb%3Fc/stream");
    expect(api.alphaCompareStreamUrl("")).toBe("/alpha/compare//stream");
  });
});

// ── 9. useSSE opens EventSource directly ───────────────────────────────────

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  init: unknown;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(url: string, init?: unknown) {
    this.url = url;
    this.init = init;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown, id = "") {
    const e = new MessageEvent(type, { data: JSON.stringify(data) });
    Object.defineProperty(e, "lastEventId", { value: id });
    (this.listeners.get(type) ?? []).forEach((fn) => fn(e));
  }
  close() {
    this.closed = true;
  }
}

describe("useSSE without tickets", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", storageWith({ [LEGACY_STORAGE_KEY]: "stale-key" }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens the exact URL synchronously on connect, no fetch, no credentials option", () => {
    const { result } = renderHook(() => useSSE());
    act(() => result.current.connect("/sessions/s1/events", {}));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/sessions/s1/events");
    expect(FakeEventSource.instances[0].init).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an existing query string untouched", () => {
    const { result } = renderHook(() => useSSE());
    act(() => result.current.connect("/x?since=5", {}));
    expect(FakeEventSource.instances[0].url).toBe("/x?since=5");
  });

  it("reconnects to the same URL with backoff and no ticket", () => {
    const { result } = renderHook(() => useSSE({ initialRetryMs: 100, backoffFactor: 2, maxRetryMs: 1000 }));
    const reconnect = vi.fn();
    act(() => result.current.connect("/swarm/runs/r/events", { reconnect }));

    act(() => FakeEventSource.instances[0].onerror?.());
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(reconnect).toHaveBeenLastCalledWith({ attempt: 1, delayMs: 100 });
    act(() => vi.advanceTimersByTime(99));
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(2);

    act(() => FakeEventSource.instances[1].onerror?.());
    expect(reconnect).toHaveBeenLastCalledWith({ attempt: 2, delayMs: 200 });
    act(() => vi.advanceTimersByTime(200));

    const urls = FakeEventSource.instances.map((s) => s.url);
    expect(urls).toEqual(["/swarm/runs/r/events", "/swarm/runs/r/events", "/swarm/runs/r/events"]);
    for (const u of urls) expect(u).not.toMatch(/ticket=|api_key=/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps the backoff at maxRetryMs", () => {
    const { result } = renderHook(() => useSSE({ initialRetryMs: 100, backoffFactor: 10, maxRetryMs: 250 }));
    const reconnect = vi.fn();
    act(() => result.current.connect("/e", { reconnect }));
    for (let i = 0; i < 3; i++) {
      act(() => FakeEventSource.instances.at(-1)!.onerror?.());
      act(() => vi.advanceTimersByTime(250));
    }
    expect(reconnect.mock.calls.map(([a]) => a.delayMs)).toEqual([100, 250, 250]);
  });

  it("resumes with only Last-Event-ID appended after a drop", () => {
    const { result } = renderHook(() => useSSE({ initialRetryMs: 10 }));
    const onText = vi.fn();
    act(() => result.current.connect("/e?x=1", { text_delta: onText }));
    act(() => FakeEventSource.instances[0].emit("text_delta", { t: "hi" }, "42"));
    expect(onText).toHaveBeenCalledWith({ t: "hi" });
    act(() => FakeEventSource.instances[0].onerror?.());
    act(() => vi.advanceTimersByTime(10));
    expect(FakeEventSource.instances[1].url).toBe("/e?x=1&Last-Event-ID=42");
  });

  it("disconnect closes the source and stops retries", () => {
    const { result } = renderHook(() => useSSE({ initialRetryMs: 10 }));
    act(() => result.current.connect("/e", {}));
    act(() => FakeEventSource.instances[0].onerror?.());
    act(() => result.current.disconnect());
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(result.current.getStatus()).toBe("disconnected");
  });

  it("source code has no ticket or key plumbing", () => {
    const src = read("hooks/useSSE.ts");
    expect(src).not.toMatch(/ticket|getApiAuthKey|withAuthTicket|apiAuth|Authorization/i);
    expect(src).toMatch(/new EventSource\(url\)/);
  });
});

// ── 10. Settings has no app API key field ──────────────────────────────────

const settingsApi = vi.hoisted(() => ({
  getLLMSettings: vi.fn(),
  getDataSourceSettings: vi.fn(),
  getChannelStatus: vi.fn(),
  getChannelsConfig: vi.fn(),
  listLLMModels: vi.fn(),
  startChannels: vi.fn(),
  stopChannels: vi.fn(),
  putChannelConfig: vi.fn(),
  testChannel: vi.fn(),
  updateLLMSettings: vi.fn(),
  updateDataSourceSettings: vi.fn(),
  listCustomProviders: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  // Only the Settings render uses this mock; the api.ts tests above load the
  // real module through vi.importActual via loadApi().
  return { ...actual, api: new Proxy(actual.api, {
    get(target, prop: string) {
      if (prop in settingsApi && (globalThis as { __T02_SETTINGS__?: boolean }).__T02_SETTINGS__) {
        return settingsApi[prop as keyof typeof settingsApi];
      }
      return target[prop as keyof typeof target];
    },
  }) };
});

describe("Settings page", () => {
  beforeEach(() => {
    (globalThis as { __T02_SETTINGS__?: boolean }).__T02_SETTINGS__ = true;
    vi.stubGlobal("localStorage", storageWith({ "vibe-trading-lang": "en" }));
    settingsApi.getLLMSettings.mockResolvedValue({
      provider: "openrouter",
      model_name: "m",
      base_url: "https://openrouter.ai/api/v1",
      api_key_env: "OPENROUTER_API_KEY",
      api_key_configured: false,
      api_key_required: true,
      temperature: 0.1,
      timeout_seconds: 120,
      max_retries: 2,
      reasoning_effort: "",
      sse_timeout_seconds: 300,
      env_path: "agent/.env",
      providers: [{
        name: "openrouter", label: "OpenRouter", api_key_env: "OPENROUTER_API_KEY",
        base_url_env: "OPENROUTER_BASE_URL", default_model: "m",
        default_base_url: "https://openrouter.ai/api/v1", api_key_required: true, auth_type: "api_key",
      }],
    });
    settingsApi.getDataSourceSettings.mockResolvedValue({
      tushare_token_configured: false, baostock_supported: true, baostock_installed: true,
      baostock_message: "ok", env_path: "agent/.env",
    });
    settingsApi.getChannelStatus.mockResolvedValue({ running: false, inbound_queue: 0, outbound_queue: 0, session_count: 0, channels: {} });
    settingsApi.getChannelsConfig.mockResolvedValue({ config_path: "agent/agent.json", writable: true, runtime_running: false, channels: {} });
    settingsApi.listLLMModels.mockResolvedValue({ provider: "openrouter", models: ["m"], source: "default" });
    settingsApi.listCustomProviders.mockResolvedValue({ status: "ok", providers: [] });
  });

  afterEach(() => {
    (globalThis as { __T02_SETTINGS__?: boolean }).__T02_SETTINGS__ = false;
    vi.unstubAllGlobals();
  });

  it("renders without any local API access / server key field", async () => {
    const { Settings } = await import("@/pages/Settings");
    render(<Settings />);
    await waitFor(() => expect(settingsApi.getLLMSettings).toHaveBeenCalled());
    await screen.findAllByText(/OpenRouter/);
    expect(screen.queryByText(/Local API access/i)).toBeNull();
    expect(screen.queryByText(/Server API key/i)).toBeNull();
    expect(screen.queryByText(/Stored only in this browser/i)).toBeNull();
    expect(screen.queryByLabelText(/Server API key|API Auth Key/i)).toBeNull();
  });

  it("never writes the legacy key to storage while rendering", async () => {
    const ls = storageWith({ "vibe-trading-lang": "en" });
    vi.stubGlobal("localStorage", ls);
    const { Settings } = await import("@/pages/Settings");
    render(<Settings />);
    await waitFor(() => expect(settingsApi.getLLMSettings).toHaveBeenCalled());
    expect(ls.setItem.mock.calls.filter(([k]) => k === LEGACY_STORAGE_KEY)).toEqual([]);
  });

  it("source drops the app key state and handler but keeps provider key fields", () => {
    const src = read("pages/Settings.tsx");
    for (const gone of ["localApiKey", "setLocalApiKeyState", "setApiAuthKey", "getApiAuthKey", "localApiAccess", "serverApiKey", "localApiKeySaved"]) {
      expect(src).not.toContain(gone);
    }
    expect(src).toMatch(/api_key_env|apiKey/);
  });
});

// ── 11. Vite proxy ─────────────────────────────────────────────────────────

describe("Vite proxy", () => {
  const config = fs.readFileSync(path.join(FRONTEND, "vite.config.ts"), "utf8");
  const block = config.match(/const PROXY_PATHS = \[([\s\S]*?)\];/)?.[1] ?? "";
  const entries = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  it("PROXY_PATHS parses and still covers the API", () => {
    expect(entries.length).toBeGreaterThan(5);
    expect(entries).toEqual(expect.arrayContaining(["/api", "/sessions", "/settings/llm", "/live", "/upload"]));
  });

  it("does not forward /auth anywhere in the config", () => {
    expect(entries.filter((p) => p === "/auth" || p.startsWith("/auth/"))).toEqual([]);
    expect(config).not.toMatch(/["'`]\^?\/auth/);
  });

  it("has no duplicate entries", () => {
    expect(new Set(entries).size).toBe(entries.length);
  });
});
