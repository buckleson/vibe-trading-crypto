// T05: typed client for /api/paper-runs and the formatting helpers in
// lib/paperRuns.ts. fetch is stubbed; nothing touches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatNumber, formatPercent, formatSigned, paperRunsApi, relativeTime, tone, toneClass,
} from "@/lib/paperRuns";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const call = (i = 0) => ({
  url: fetchMock.mock.calls[i][0] as string,
  init: (fetchMock.mock.calls[i][1] ?? {}) as RequestInit,
});
const method = (i = 0) => (call(i).init.method ?? "GET").toUpperCase();
const header = (i: number, name: string) => new Headers(call(i).init.headers).get(name);

describe("T05 paperRunsApi routes", () => {
  it("list is GET /api/paper-runs with no body and returns the parsed array", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "p1" }, { id: "p2" }]));
    const out = await paperRunsApi.list();
    expect(out).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(call().url).toBe("/api/paper-runs");
    expect(method()).toBe("GET");
    expect(call().init.body).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("create is POST /api/paper-runs with a JSON body and content-type header", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "new" }));
    const out = await paperRunsApi.create({ run_id: "r1", label: "My run", initial_cash: 2500.5 });
    expect(out).toEqual({ id: "new" });
    expect(call().url).toBe("/api/paper-runs");
    expect(method()).toBe("POST");
    expect(JSON.parse(call().init.body as string)).toEqual({ run_id: "r1", label: "My run", initial_cash: 2500.5 });
    expect(header(0, "content-type")).toContain("application/json");
  });

  it("create with only run_id does not invent label or initial_cash", async () => {
    await paperRunsApi.create({ run_id: "r9" });
    expect(JSON.parse(call().init.body as string)).toEqual({ run_id: "r9" });
  });

  it("get is GET /api/paper-runs/<id>", async () => {
    await paperRunsApi.get("p1");
    expect(call().url).toBe("/api/paper-runs/p1");
    expect(method()).toBe("GET");
  });

  it("refresh and stop are POST to their sub-routes without a body", async () => {
    await paperRunsApi.refresh("p1");
    await paperRunsApi.stop("p1");
    expect(call(0).url).toBe("/api/paper-runs/p1/refresh");
    expect(method(0)).toBe("POST");
    expect(call(0).init.body).toBeUndefined();
    expect(call(1).url).toBe("/api/paper-runs/p1/stop");
    expect(method(1)).toBe("POST");
    expect(call(1).init.body).toBeUndefined();
  });

  it("remove is DELETE /api/paper-runs/<id> and returns {deleted}", async () => {
    fetchMock.mockResolvedValueOnce(json({ deleted: true }));
    await expect(paperRunsApi.remove("p1")).resolves.toEqual({ deleted: true });
    expect(call().url).toBe("/api/paper-runs/p1");
    expect(method()).toBe("DELETE");
  });

  it.each([
    ["a/b", "a%2Fb"],
    ["with space", "with%20space"],
    ["q?x=1#h", "q%3Fx%3D1%23h"],
    ["..", ".."],
    ["ünï", "%C3%BCn%C3%AF"],
  ])("encodes id %j in every id route", async (id, enc) => {
    await paperRunsApi.get(id);
    await paperRunsApi.refresh(id);
    await paperRunsApi.stop(id);
    await paperRunsApi.remove(id);
    expect(call(0).url).toBe(`/api/paper-runs/${enc}`);
    expect(call(1).url).toBe(`/api/paper-runs/${enc}/refresh`);
    expect(call(2).url).toBe(`/api/paper-runs/${enc}/stop`);
    expect(call(3).url).toBe(`/api/paper-runs/${enc}`);
  });
});

describe("T05 paperRunsApi errors", () => {
  it("422 with a string detail rejects with that message (shown in the start dialog)", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "run r1 has no strategy code" }, 422));
    await expect(paperRunsApi.create({ run_id: "r1" })).rejects.toThrow("run r1 has no strategy code");
  });

  it("422 with a pydantic detail list joins loc and msg", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: [{ loc: ["body", "initial_cash"], msg: "must be > 0" }] }, 422));
    await expect(paperRunsApi.create({ run_id: "r1", initial_cash: -1 })).rejects.toThrow("body.initial_cash: must be > 0");
  });

  it("404 on get rejects with the server detail and a status", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Paper run not found" }, 404));
    await expect(paperRunsApi.get("nope")).rejects.toMatchObject({ message: "Paper run not found", status: 404 });
  });

  it("an empty 200 body resolves to an empty object rather than throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(paperRunsApi.list()).resolves.toEqual({});
  });

  it("a non JSON 200 (SPA html fallback) rejects", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(paperRunsApi.list()).rejects.toThrow(/Expected JSON/);
  });

  it("network failure propagates", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(paperRunsApi.stop("p1")).rejects.toThrow();
  });
});

describe("T05 refresh timeout", () => {
  // A fetch that only settles when its AbortSignal fires.
  const hang = () =>
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));

  it("refresh survives past the default 120 s and is aborted at 180 s", async () => {
    vi.useFakeTimers();
    hang();
    let settled: unknown = "pending";
    const p = paperRunsApi.refresh("p1").then(() => (settled = "ok"), (e) => (settled = e));
    await vi.advanceTimersByTimeAsync(170_000);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(11_000);
    await p;
    expect(settled).toBeInstanceOf(Error);
    expect((settled as { code?: string }).code).toBe("request_timeout");
  });

  it("other calls keep the default (shorter) timeout", async () => {
    vi.useFakeTimers();
    hang();
    let settled: unknown = "pending";
    const p = paperRunsApi.get("p1").then(() => (settled = "ok"), (e) => (settled = e));
    await vi.advanceTimersByTimeAsync(170_000);
    await p;
    expect(settled).toBeInstanceOf(Error);
  });
});

describe("T05 format helpers", () => {
  it("formatNumber always shows two decimals", () => {
    expect(formatNumber(0)).toMatch(/^0[.,]00$/);
    expect(formatNumber(1.005)).toMatch(/^1[.,]0[01]$/);
    expect(formatNumber(-12.3)).toMatch(/^-12[.,]30$/);
    expect(formatNumber(1234567.891)).toMatch(/^1[.,\s  ]?234[.,\s  ]?567[.,]89$/);
  });

  it("formatPercent scales by 100, signs only gains when asked", () => {
    expect(formatPercent(0.1234)).toMatch(/^12[.,]34%$/);
    expect(formatPercent(0.1, true)).toMatch(/^\+10[.,]00%$/);
    expect(formatPercent(-0.05, true)).toMatch(/^-5[.,]00%$/);
    expect(formatPercent(0, true)).toMatch(/^0[.,]00%$/);
    expect(formatPercent(0.1)).not.toContain("+");
  });

  it("formatSigned adds + only for positive values", () => {
    expect(formatSigned(5)).toMatch(/^\+5[.,]00$/);
    expect(formatSigned(-5)).toMatch(/^-5[.,]00$/);
    expect(formatSigned(0)).toMatch(/^0[.,]00$/);
  });

  it("tone and toneClass map sign to success/danger and treat 0/null/undefined as neutral", () => {
    expect(tone(1)).toBe("success");
    expect(tone(-0.0001)).toBe("danger");
    expect(tone(0)).toBe("neutral");
    expect(tone(null)).toBe("neutral");
    expect(tone(undefined)).toBe("neutral");
    expect(toneClass(2)).toBe("text-success");
    expect(toneClass(-2)).toBe("text-danger");
    expect(toneClass(0)).toBe("");
    expect(toneClass(null)).toBe("");
  });

  it("relativeTime boundaries", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime("not a date", now)).toBeNull();
    expect(relativeTime(ago(0), now)).toBe("just now");
    expect(relativeTime(ago(20_000), now)).toBe("just now");
    expect(relativeTime(ago(-600_000), now)).toBe("just now"); // future clock skew
    expect(relativeTime(ago(3 * 60_000), now)).toBe("3 min ago");
    expect(relativeTime(ago(59 * 60_000), now)).toBe("59 min ago");
    expect(relativeTime(ago(60 * 60_000), now)).toBe("1 h ago");
    expect(relativeTime(ago(23 * 3600_000), now)).toBe("23 h ago");
    expect(relativeTime(ago(24 * 3600_000), now)).toBe("1 d ago");
    expect(relativeTime(ago(10 * 24 * 3600_000), now)).toBe("10 d ago");
  });

  it("relativeTime defaults now to the current clock", () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 min ago");
  });
});
