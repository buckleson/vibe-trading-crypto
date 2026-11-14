import { paperRunsApi, relativeTime, formatPercent } from "../paperRuns";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => ({ url: fetchMock.mock.calls[i][0] as string, init: fetchMock.mock.calls[i][1] as RequestInit });

test("list and get use GET with encoded ids", async () => {
  await paperRunsApi.list();
  expect(call().url).toBe("/api/paper-runs");
  await paperRunsApi.get("a/b");
  expect(call(1).url).toBe("/api/paper-runs/a%2Fb");
  expect(call(1).init.method ?? "GET").toBe("GET");
});

test("create posts the body", async () => {
  await paperRunsApi.create({ run_id: "r1", label: "x", initial_cash: 5 });
  expect(call().url).toBe("/api/paper-runs");
  expect(call().init.method).toBe("POST");
  expect(JSON.parse(call().init.body as string)).toEqual({ run_id: "r1", label: "x", initial_cash: 5 });
});

test("refresh, stop and remove hit their routes", async () => {
  await paperRunsApi.refresh("p1");
  await paperRunsApi.stop("p1");
  await paperRunsApi.remove("p1");
  expect(call(0)).toMatchObject({ url: "/api/paper-runs/p1/refresh", init: { method: "POST" } });
  expect(call(1)).toMatchObject({ url: "/api/paper-runs/p1/stop", init: { method: "POST" } });
  expect(call(2)).toMatchObject({ url: "/api/paper-runs/p1", init: { method: "DELETE" } });
});

test("formatters", () => {
  expect(formatPercent(0.1, true)).toMatch(/^\+10[.,]00%$/);
  const now = Date.parse("2026-01-01T00:10:00Z");
  expect(relativeTime("2026-01-01T00:07:00Z", now)).toBe("3 min ago");
  expect(relativeTime(null, now)).toBeNull();
});
