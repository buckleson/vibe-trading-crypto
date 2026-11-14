// T08: rendered checks for the restyled chat surface (WelcomeScreen,
// MessageBubble, ProgressBar, ToolProgressIndicator, Composer, MetricsCard,
// RunCompleteCard). Offline: api and toast are mocked, no network.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ProgressBar } from "@/components/chat/ProgressBar";
import { ToolProgressIndicator } from "@/components/chat/ToolProgressIndicator";
import { Composer } from "@/components/chat/Composer";
import { MetricsCard } from "@/components/chat/MetricsCard";
import { RunCompleteCard } from "@/components/chat/RunCompleteCard";
import { makeMessage } from "@/tests/helpers/factories";
import type { ToolCallEntry } from "@/types/agent";

const apiMock = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  getRunPreview: vi.fn(),
  getRunPine: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(async () => { await i18n.changeLanguage("en"); });

const BANNED_CLASS = /\b(uppercase|font-serif|tracking-(wider|widest)|bg-gradient-\S+|rounded-(xl|2xl|3xl)|animate-pulse|animate-ping|text-\[(9|10|11)px\])\b/;
const bannedIn = (root: Element) =>
  [root, ...Array.from(root.querySelectorAll("*"))]
    .map((el) => el.getAttribute("class") ?? "")
    .filter((c) => BANNED_CLASS.test(c));

describe("T08 WelcomeScreen", () => {
  it("title is text-xl font-semibold, not serif, with a 13px muted subtitle", () => {
    render(<WelcomeScreen onExample={vi.fn()} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveClass("text-xl", "font-semibold");
    expect(h1.className).not.toMatch(/serif|text-(3xl|4xl|5xl)/);
    const sub = h1.nextElementSibling!;
    expect(sub.tagName).toBe("P");
    expect(sub).toHaveClass("text-[13px]", "text-muted-foreground");
  });

  it("quick actions are a labelled 2-column grid with 16px icons and no numbering", () => {
    render(<WelcomeScreen onExample={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Quick actions" });
    expect(group).toHaveClass("grid", "sm:grid-cols-2");
    const buttons = within(group).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) {
      expect(b.textContent).not.toMatch(/\b0[1-9]\b|^\s*\d+[.)]/);
      expect(b).toHaveClass("rounded-lg");
      const svg = b.querySelector("svg")!;
      expect(svg.getAttribute("class")).toMatch(/h-4 w-4/);
    }
  });

  it("clicking a quick action sends its prompt and marks it pressed (one at a time)", () => {
    const onExample = vi.fn();
    render(<WelcomeScreen onExample={onExample} />);
    const [first, second] = within(screen.getByRole("group", { name: "Quick actions" })).getAllByRole("button");
    fireEvent.click(first);
    expect(onExample).toHaveBeenCalledTimes(1);
    expect(typeof onExample.mock.calls[0][0]).toBe("string");
    expect(onExample.mock.calls[0][0].length).toBeGreaterThan(0);
    expect(first).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("featured examples are a 2-column list and the library toggles with Escape", () => {
    const onExample = vi.fn();
    render(<WelcomeScreen onExample={onExample} />);
    const featured = screen.getByRole("heading", { level: 2 }).nextElementSibling!;
    expect(featured).toHaveClass("sm:grid-cols-2");
    fireEvent.click(within(featured as HTMLElement).getAllByRole("button")[0]);
    expect(onExample).toHaveBeenCalledTimes(1);

    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const library = document.getElementById("welcome-example-library")!;
    expect(library).toHaveAttribute("aria-hidden", "false");
    fireEvent.keyDown(library, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("category tabs switch the visible examples", () => {
    render(<WelcomeScreen onExample={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const tabs = screen.getAllByRole("tab", { hidden: true });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });

  it("renders no banned classes", () => {
    const { container } = render(<WelcomeScreen onExample={vi.fn()} />);
    expect(bannedIn(container)).toEqual([]);
  });
});

describe("T08 MessageBubble", () => {
  it("user message is a right-aligned bg-muted rounded-lg px-3 py-2 bubble", () => {
    render(<MessageBubble msg={makeMessage({ type: "user", content: "Backtest BTC" })} />);
    const bubble = screen.getByText("Backtest BTC");
    expect(bubble).toHaveClass("bg-muted", "rounded-lg", "px-3", "py-2");
    expect(bubble.parentElement).toHaveClass("flex", "justify-end");
  });

  it("user bubble keeps attachment, swarm and goal chips", () => {
    render(
      <MessageBubble
        msg={makeMessage({
          type: "user",
          content: "With file",
          meta: {
            attachments: [{ filename: "trades.csv", filePath: "/tmp/trades.csv" }],
            swarmMode: true,
            goalMode: true,
          },
        } as never)}
      />,
    );
    expect(screen.getByText("trades.csv")).toBeInTheDocument();
    const bubble = screen.getByText("trades.csv").closest(".bg-muted")!;
    expect(bubble).toHaveClass("rounded-lg");
  });

  it("assistant answer is unboxed full-width prose", () => {
    const { container } = render(
      <MessageBubble msg={makeMessage({ type: "answer", content: "Plain **answer** text" })} />,
    );
    const prose = container.querySelector(".prose")!;
    expect(prose).toHaveClass("prose", "prose-sm", "dark:prose-invert", "max-w-none");
    // No bubble chrome around the answer.
    let el: Element | null = prose;
    while (el && el !== container) {
      const tokens = el.className.split(/\s+/);
      expect(tokens).not.toContain("bg-muted");
      expect(tokens).not.toContain("border");
      expect(tokens).not.toContain("rounded-lg");
      el = el.parentElement;
    }
    expect(bannedIn(container)).toEqual([]);
  });

  it("answer elapsed time formats ms, seconds and minutes", () => {
    const { rerender } = render(<MessageBubble msg={makeMessage({ type: "answer", content: "a", elapsed_ms: 0.2 } as never)} />);
    expect(screen.getByText("1 ms")).toBeInTheDocument();
    rerender(<MessageBubble msg={makeMessage({ type: "answer", content: "b", elapsed_ms: 2500 } as never)} />);
    expect(screen.getByText("2.5 s")).toBeInTheDocument();
    rerender(<MessageBubble msg={makeMessage({ type: "answer", content: "c", elapsed_ms: 125_000 } as never)} />);
    expect(screen.getByText("2m 5s")).toBeInTheDocument();
  });

  it("error message uses danger tokens and retry calls back with the message", () => {
    const onRetry = vi.fn();
    const msg = makeMessage({ type: "error", content: "429 rate limit" });
    render(<MessageBubble msg={msg} onRetry={onRetry} />);
    const text = screen.getByText("429 rate limit");
    expect(text).toHaveClass("text-danger");
    expect(text.parentElement).toHaveClass("border-danger/30", "rounded-lg");
    fireEvent.click(screen.getByRole("button", { name: /Retry|Try again/i }));
    expect(onRetry).toHaveBeenCalledWith(msg);
  });

  it("error without onRetry renders no retry button", () => {
    render(<MessageBubble msg={makeMessage({ type: "error", content: "boom" })} />);
    expect(screen.queryByRole("button", { name: /Retry|Try again/i })).toBeNull();
  });

  it("unknown type with empty content renders nothing", () => {
    const { container } = render(<MessageBubble msg={makeMessage({ type: "thinking" as never, content: "" })} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("T08 ProgressBar", () => {
  it("default bar is 2px (h-0.5), primary fill, no glow", () => {
    const { container } = render(<ProgressBar current={1} total={4} />);
    const track = container.querySelector(".bg-muted")!;
    expect(track).toHaveClass("h-0.5");
    const fill = track.firstElementChild as HTMLElement;
    expect(fill).toHaveClass("bg-primary");
    expect(fill.style.width).toBe("25%");
    expect(container.innerHTML).not.toMatch(/shadow|glow|animate-pulse/);
  });

  it.each([
    [-5, 10, "0%", 0],
    [15, 10, "100%", 10],
    [10, 10, "100%", 10],
    [0, 10, "0%", 0],
  ])("clamps current=%s of total=%s to %s", (current, total, width, clamped) => {
    const { container } = render(<ProgressBar current={current} total={total} showCount />);
    const fill = container.querySelector(".bg-primary") as HTMLElement;
    expect(fill.style.width).toBe(width);
    expect(container.querySelector("progress")).toHaveAttribute("value", String(clamped));
    expect(screen.getByText(`${clamped}/${total}`)).toBeInTheDocument();
  });

  it.each([0, -1])("renders nothing when total is %s", (total) => {
    const { container } = render(<ProgressBar current={1} total={total} />);
    expect(container.innerHTML).toBe("");
  });

  it("sm height and aria label pass through to the native progress", () => {
    const { container } = render(<ProgressBar current={1} total={2} height="sm" ariaLabel="PDF pages" />);
    expect(container.querySelector(".bg-muted")).toHaveClass("h-2");
    expect(screen.getByLabelText("PDF pages", { selector: "progress" })).toHaveClass("sr-only");
  });
});

function tc(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return { id: "tc-1", tool: "backtest", arguments: {}, status: "running", timestamp: 1, ...overrides };
}

describe("T08 ToolProgressIndicator rows", () => {
  it("running step: 13px row with a single 16px spinner, no pulsing", () => {
    const { container } = render(<ToolProgressIndicator toolCalls={[tc()]} />);
    const spinners = container.querySelectorAll(".animate-spin");
    expect(spinners).toHaveLength(1);
    expect(spinners[0].getAttribute("class")).toMatch(/h-4 w-4/);
    expect(container.querySelector(".text-\\[13px\\]")).not.toBeNull();
    expect(bannedIn(container)).toEqual([]);
  });

  it("ok and error steps use success and danger icons, no spinner", () => {
    const { container } = render(
      <ToolProgressIndicator toolCalls={[tc({ status: "ok" }), tc({ id: "tc-2", status: "error", tool: "read_url" })]} />,
    );
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
    expect(container.querySelector("svg.text-success")).not.toBeNull();
    expect(container.querySelector("svg.text-danger")).not.toBeNull();
  });

  it("determinate progress shows a 2px bar with count instead of a spinner", () => {
    const { container } = render(
      <ToolProgressIndicator toolCalls={[tc({ progress: { current: 3, total: 12, stage: "Loading" } } as never)]} />,
    );
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
    expect(screen.getByText("3/12")).toBeInTheDocument();
    expect(container.querySelector(".h-0\\.5")).not.toBeNull();
  });

  it("empty list renders nothing", () => {
    const { container } = render(<ToolProgressIndicator toolCalls={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

const composerProps = () => ({
  streaming: false,
  hasCompletedTurn: false,
  showExport: false,
  canExport: false,
  goalComposerActive: false,
  swarmPreset: null,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  onExport: vi.fn(),
  onStartGoal: vi.fn(),
  onCancelGoal: vi.fn(),
  onStartSwarm: vi.fn(),
  onCancelSwarm: vi.fn(),
});

describe("T08 Composer", () => {
  beforeEach(() => { apiMock.uploadFile.mockReset(); });

  it("textarea sits in a bordered rounded-lg bg-card container", () => {
    render(<Composer {...composerProps()} />);
    const box = screen.getByRole("textbox", { name: /message/i }).parentElement!;
    expect(box).toHaveClass("rounded-lg", "border", "bg-card");
  });

  it("send is a primary icon button, disabled until there is text", () => {
    const props = composerProps();
    render(<Composer {...props} />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();
    expect(send.className).toMatch(/\bbg-primary\b/);
    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "   " } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "Run it" } });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    expect(props.onSubmit).toHaveBeenCalledWith("Run it", []);
  });

  it("only one primary button in the composer row while idle", () => {
    render(<Composer {...composerProps()} showExport canExport />);
    const box = screen.getByRole("textbox", { name: /message/i }).parentElement!;
    const primaries = within(box).getAllByRole("button").filter((b) => /\bbg-primary\b/.test(b.className));
    expect(primaries).toHaveLength(1);
    const exp = screen.getByRole("button", { name: "Export chat" });
    expect(exp.className).not.toMatch(/\bbg-primary\b/);
  });

  it("export is disabled when nothing can be exported", () => {
    const props = composerProps();
    render(<Composer {...props} showExport canExport={false} />);
    expect(screen.getByRole("button", { name: "Export chat" })).toBeDisabled();
  });

  it("while streaming the textarea is read-only and stop replaces send", () => {
    const props = composerProps();
    render(<Composer {...props} streaming />);
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    const stop = screen.getByTitle("Stop generation");
    expect(stop.className).toMatch(/\bbg-destructive\b/);
    fireEvent.click(stop);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders no banned classes", () => {
    const { container } = render(<Composer {...composerProps()} showExport />);
    expect(bannedIn(container)).toEqual([]);
  });
});

describe("T08 MetricsCard and RunCompleteCard", () => {
  it("MetricsCard renders inside a Card with tabular values and token colors", () => {
    const { container } = render(
      <MetricsCard metrics={{ total_return: 0.1, annual_return: -0.05, trade_count: 7 }} />,
    );
    const card = container.firstElementChild!;
    expect(card).toHaveClass("rounded-lg", "border", "bg-card");
    const values = Array.from(card.querySelectorAll("p.tabular-nums"));
    expect(values).toHaveLength(3);
    expect(values[0]).toHaveClass("text-success");
    expect(values[1]).toHaveClass("text-danger");
    expect(card.textContent).toContain("+10.00%");
    expect(card.textContent).toContain("-5.00%");
    expect(bannedIn(container)).toEqual([]);
  });

  it("MetricsCard with no known metrics renders nothing", () => {
    const { container } = render(<MetricsCard metrics={{ unknown_key: 1 }} />);
    expect(container.innerHTML).toBe("");
  });

  it("MetricsCard compact caps the grid at 6 metrics", () => {
    const { container } = render(
      <MetricsCard
        compact
        metrics={{ total_return: 0.1, annual_return: 0.1, sharpe: 1, max_drawdown: -0.1, win_rate: 0.5, trade_count: 3, calmar: 1, sortino: 1 }}
      />,
    );
    expect(container.querySelectorAll("p.tabular-nums")).toHaveLength(6);
    expect(container.firstElementChild).toHaveClass("grid-cols-3");
  });

  it("RunCompleteCard uses a Card and keeps the dashboard link", () => {
    apiMock.getRunPreview.mockResolvedValue({ metrics: null, equity_curve: [], report_worthy: true });
    apiMock.getRunPine.mockResolvedValue({ exists: false, content: null });
    const { container } = render(
      <MemoryRouter>
        <RunCompleteCard msg={makeMessage({ type: "run_complete", runId: "r-9", metrics: { total_return: 0.2 } } as never)} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Full Report/i })).toHaveAttribute("href", "/runs/r-9?view=dashboard");
    expect(container.querySelector(".bg-card.rounded-lg")).not.toBeNull();
    expect(bannedIn(container)).toEqual([]);
  });
});
