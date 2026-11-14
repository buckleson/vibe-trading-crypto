// T09: Runtime (Stat summary, status Badges, empty/error states) and Scheduled
// (header primary "New schedule", Table list, status Badge tones, two-step
// danger delete, composer reset). Offline: api is mocked.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { api, type LiveStatus, type ScheduledRun } from "@/lib/api";
import { Runtime } from "@/pages/Runtime";
import { Scheduled } from "@/pages/Scheduled";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getLiveStatus: vi.fn(),
      verifyConnector: vi.fn(),
      listScheduledRuns: vi.fn(),
      createScheduledRun: vi.fn(),
      updateScheduledRun: vi.fn(),
      deleteScheduledRun: vi.fn(),
      getChannelStatus: vi.fn(),
      getChannelsConfig: vi.fn(),
    },
  };
});

type Fn = ReturnType<typeof vi.fn>;
const mocked = api as unknown as Record<string, Fn>;

beforeAll(async () => { await i18n.changeLanguage("en"); });
afterEach(() => { vi.useRealTimers(); });

// ---------------------------------------------------------------- Runtime

function broker(name: string, over: { alive?: boolean; token?: boolean; halted?: boolean } = {}) {
  return {
    auth: { broker: name, oauth_token_present: over.token ?? true, is_live_broker: true },
    runner: { broker: name, alive: over.alive ?? true, last_tick: null, last_tick_age_seconds: 3 },
    mandate: null,
    halted: over.halted ?? false,
  };
}

function liveStatus(over: Partial<LiveStatus> = {}): LiveStatus {
  return { global_halted: false, brokers: [broker("paper")], ...over } as LiveStatus;
}

describe("Runtime page", () => {
  beforeEach(() => {
    mocked.getLiveStatus.mockReset();
    mocked.verifyConnector.mockReset();
  });

  it("has a page header with a secondary Refresh action", async () => {
    mocked.getLiveStatus.mockResolvedValue(liveStatus());
    render(<Runtime />);
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(/Runtime/);
    const refresh = screen.getByRole("button", { name: /Refresh/ });
    expect(refresh.className).not.toMatch(/\bbg-primary\b/);
  });

  it("shows aria-busy skeletons while loading", () => {
    mocked.getLiveStatus.mockReturnValue(new Promise(() => {}));
    const { container } = render(<Runtime />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("summary Stats: Clear in success tone, counts for brokers/authorized/runners", async () => {
    mocked.getLiveStatus.mockResolvedValue(liveStatus({
      brokers: [broker("paper"), broker("sandbox", { alive: false, token: false })],
    } as Partial<LiveStatus>));
    render(<Runtime />);
    const clear = await screen.findByText("Clear");
    expect(clear.className).toMatch(/text-success/);
    expect(screen.getByText("Brokers").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Authorized").nextElementSibling).toHaveTextContent("1");
  });

  it("global halt shows Halted in danger tone", async () => {
    mocked.getLiveStatus.mockResolvedValue(liveStatus({ global_halted: true }));
    render(<Runtime />);
    const halted = await screen.findByText("Global Halt");
    expect(halted.nextElementSibling).toHaveTextContent("Halted");
    expect(halted.nextElementSibling!.className).toMatch(/text-danger/);
  });

  it("status pills are Badges with token tones", async () => {
    mocked.getLiveStatus.mockResolvedValue(liveStatus({
      brokers: [broker("paper"), broker("sandbox", { alive: false, token: false })],
    } as Partial<LiveStatus>));
    render(<Runtime />);
    expect((await screen.findByText("auth present")).className).toMatch(/rounded-sm .*text-success|text-success/);
    expect(screen.getByText("auth missing").className).toMatch(/text-(danger|warning|muted-foreground)/);
  });

  it("shows the EmptyState when no brokers are reported", async () => {
    mocked.getLiveStatus.mockResolvedValue(liveStatus({ brokers: [] }));
    render(<Runtime />);
    expect(await screen.findByText("No runtime profiles reported")).toBeInTheDocument();
  });

  it("fails closed with an alert card when status is unavailable", async () => {
    mocked.getLiveStatus.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Runtime />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Runtime status unavailable");
    expect(alert).toHaveTextContent("offline");
    expect(screen.queryByText("Brokers")).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it("does not render any uppercase-styled labels", async () => {
    mocked.getLiveStatus.mockResolvedValue(liveStatus());
    const { container } = render(<Runtime />);
    await screen.findByText("Clear");
    expect(container.querySelector(".uppercase")).toBeNull();
    expect(container.querySelector('[class*="tracking-wide"]')).toBeNull();
  });
});

// -------------------------------------------------------------- Scheduled

function run(over: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    id: "job-1", prompt: "scan movers", title: "", source_type: "prompt", playbook_slug: null, end_at: null,
    schedule: "0 9 * * *", next_run_at: 1_790_000_000_000, status: "pending", created_at: 1_780_000_000_000,
    last_run_at: null, consecutive_failures: 0, last_error: null, failure_kind: null, config: {},
    timezone: "UTC", delivery_channel: null, delivery_target: null, delivery_target_ref: null,
    delivery_target_label: null, delivery_format: null, delivery_status: "none", delivery_error: null,
    delivery_updated_at: null, delivery_attempts: 0, delivery_provider_message_id: null, last_verdict: null,
    ...over,
  } as ScheduledRun;
}

describe("Scheduled page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listScheduledRuns.mockResolvedValue([]);
    mocked.getChannelStatus.mockResolvedValue({ running: false, inbound_queue: 0, outbound_queue: 0, session_count: 0, channels: {} });
    mocked.getChannelsConfig.mockResolvedValue({ channels: {} });
  });

  it("header title and a single primary New schedule action", async () => {
    render(<Scheduled />);
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1.textContent!.toLowerCase()).toBe("scheduled research");
    const button = screen.getByRole("button", { name: "New schedule" });
    expect(button.className).toMatch(/\bbg-primary\b/);
  });

  it("New schedule focuses the prompt field", async () => {
    render(<Scheduled />);
    await screen.findByText(/No scheduled runs yet/);
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    expect(screen.getByLabelText("Research prompt")).toHaveFocus();
  });

  it("New schedule leaves edit mode and clears the composer", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run()]);
    render(<Scheduled />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit scheduled run: scan movers" }));
    expect(screen.getByText(/Editing this scheduled run/)).toBeInTheDocument();
    expect(screen.getByLabelText("Research prompt")).toHaveValue("scan movers");
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    expect(screen.queryByText(/Editing this scheduled run/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Research prompt")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Schedule run/ })).toBeInTheDocument();
  });

  it("New schedule clears typed-but-unsaved text", async () => {
    render(<Scheduled />);
    await screen.findByText(/No scheduled runs yet/);
    fireEvent.change(screen.getByLabelText("Research prompt"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    expect(screen.getByLabelText("Research prompt")).toHaveValue("");
  });

  it("shows the EmptyState and no table when there are no runs", async () => {
    render(<Scheduled />);
    expect(await screen.findByText(/No scheduled runs yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("list is a Table with Schedule, Next run, Last status, Actions columns inside a scroll wrapper", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run()]);
    render(<Scheduled />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Schedule", "Next run", "Last status", "Actions",
    ]);
    expect(within(table).getByRole("columnheader", { name: "Actions" }).className).toMatch(/text-right/);
    expect(table.parentElement!.className).toMatch(/overflow-x-auto/);
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it.each([
    ["completed", "Completed", /text-success/],
    ["failed", "Failed", /text-danger/],
    ["running", "Running", /text-warning/],
    ["pending", "Pending", /text-muted-foreground/],
    ["cancelled", "Cancelled", /text-muted-foreground/],
    ["expired", "Expired", /text-muted-foreground/],
  ] as const)("status %s renders a %s Badge with the right tone", async (status, label, tone) => {
    mocked.listScheduledRuns.mockResolvedValue([run({ status })]);
    render(<Scheduled />);
    const table = await screen.findByRole("table");
    const badge = within(table).getByText(label);
    expect(badge.className).toMatch(tone);
  });

  it("expired runs say No further runs instead of a next-run time", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run({ status: "expired" })]);
    render(<Scheduled />);
    expect(await screen.findByText("No further runs")).toBeInTheDocument();
  });

  it("shows the last error under the status", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run({ status: "failed", last_error: "LLM timeout" })]);
    render(<Scheduled />);
    expect(await screen.findByText(/LLM timeout/)).toBeInTheDocument();
  });

  it("disables Edit for a running job", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run({ status: "running" })]);
    render(<Scheduled />);
    expect(await screen.findByRole("button", { name: "Edit scheduled run: scan movers" })).toBeDisabled();
  });

  it("delete is two-step: arm, then a danger Confirm calls the API once", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run()]);
    mocked.deleteScheduledRun.mockResolvedValue(undefined);
    render(<Scheduled />);
    const del = await screen.findByRole("button", { name: "Delete scheduled run: scan movers" });
    expect(del.className).not.toMatch(/bg-destructive/);
    fireEvent.click(del);
    expect(mocked.deleteScheduledRun).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirm deleting scheduled run: scan movers" });
    expect(confirm.className).toMatch(/bg-destructive/);
    mocked.listScheduledRuns.mockResolvedValue([]);
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(() => expect(mocked.deleteScheduledRun).toHaveBeenCalledTimes(1));
    expect(mocked.deleteScheduledRun.mock.calls[0][0]).toBe("job-1");
  });

  it("Cancel disarms the delete without calling the API", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run()]);
    render(<Scheduled />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete scheduled run: scan movers" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: /Confirm deleting/ })).not.toBeInTheDocument();
    expect(mocked.deleteScheduledRun).not.toHaveBeenCalled();
  });

  it("an armed delete auto-disarms after 5 seconds", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run()]);
    render(<Scheduled />);
    const del = await screen.findByRole("button", { name: "Delete scheduled run: scan movers" });
    vi.useFakeTimers();
    fireEvent.click(del);
    expect(screen.getByRole("button", { name: /Confirm deleting/ })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(screen.queryByRole("button", { name: /Confirm deleting/ })).not.toBeInTheDocument();
  });

  it("only one row is armed at a time", async () => {
    mocked.listScheduledRuns.mockResolvedValue([run(), run({ id: "job-2", prompt: "second" })]);
    render(<Scheduled />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete scheduled run: scan movers" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete scheduled run: second" }));
    expect(screen.getAllByRole("button", { name: /Confirm deleting/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm deleting scheduled run: second" })).toBeInTheDocument();
  });

  it("list load failure with no rows shows an alert and a Retry that reloads", async () => {
    mocked.listScheduledRuns.mockRejectedValueOnce(new Error("list failed"));
    render(<Scheduled />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("list failed");
    mocked.listScheduledRuns.mockResolvedValue([run()]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("composer submit is the primary button and the composer lives in a Card", async () => {
    render(<Scheduled />);
    await screen.findByText(/No scheduled runs yet/);
    const submit = screen.getByRole("button", { name: /Schedule run/ });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit.className).toMatch(/\bbg-primary\b/);
    expect(submit.closest("form")!.closest(".rounded-lg")).not.toBeNull();
  });

  it("composer does not submit with an empty prompt", async () => {
    render(<Scheduled />);
    await screen.findByText(/No scheduled runs yet/);
    fireEvent.submit(screen.getByRole("button", { name: /Schedule run/ }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocked.createScheduledRun).not.toHaveBeenCalled();
  });
});
