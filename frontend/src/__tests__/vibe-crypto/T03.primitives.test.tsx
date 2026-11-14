// T03: components/ui primitive layer. Offline, jsdom only.
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Inbox } from "lucide-react";

import * as UI from "@/components/ui";
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Page, PageHeader,
  Select, Stat, TBody, TD, TH, THead, TR, Table, Tabs, Textarea,
} from "@/components/ui";
import { Skeleton } from "@/components/common/Skeleton";

const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("T03 ui barrel", () => {
  it.each([
    "Button", "Card", "CardHeader", "CardBody", "Badge", "Input", "Select", "Textarea", "Field", "Tabs",
    "PageHeader", "Page", "Stat", "EmptyState", "Table", "THead", "TBody", "TR", "TH", "TD",
  ])("exports %s", (name) => {
    const v = (UI as Record<string, unknown>)[name];
    expect(v).toBeDefined();
    expect(["function", "object"]).toContain(typeof v);
  });
});

describe("T03 Button", () => {
  it("defaults to secondary, md, type=button", () => {
    render(<Button>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveAttribute("type", "button");
    expect(cls(b)).toEqual(expect.arrayContaining(["border", "border-border", "bg-card", "hover:bg-muted", "h-9"]));
    expect(b).not.toHaveAttribute("aria-busy");
    expect(b).toBeEnabled();
  });

  it.each([
    ["primary", ["bg-primary", "text-primary-foreground"]],
    ["secondary", ["border", "bg-card", "hover:bg-muted"]],
    ["ghost", ["hover:bg-muted"]],
    ["danger", ["bg-destructive", "text-destructive-foreground"]],
  ] as const)("variant %s", (variant, expected) => {
    render(<Button variant={variant}>x</Button>);
    expect(cls(screen.getByRole("button"))).toEqual(expect.arrayContaining([...expected]));
  });

  it("ghost has no border or fill", () => {
    render(<Button variant="ghost">x</Button>);
    const c = cls(screen.getByRole("button"));
    expect(c).not.toContain("border");
    expect(c.some((k) => /^bg-(primary|card|destructive)$/.test(k))).toBe(false);
  });

  it.each([
    ["sm", ["h-8"]],
    ["md", ["h-9"]],
    ["icon", ["h-9", "w-9"]],
  ] as const)("size %s", (size, expected) => {
    render(<Button size={size} aria-label="b">x</Button>);
    expect(cls(screen.getByRole("button"))).toEqual(expect.arrayContaining([...expected]));
  });

  it("shared focus, disabled and motion classes", () => {
    render(<Button>x</Button>);
    expect(cls(screen.getByRole("button"))).toEqual(expect.arrayContaining([
      "focus-visible:outline-none", "focus-visible:ring-2", "focus-visible:ring-primary/40",
      "disabled:opacity-50", "disabled:pointer-events-none", "transition-colors", "duration-150", "rounded-md",
    ]));
  });

  it("loading disables, sets aria-busy and shows a 14px spinner; click is ignored", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Run</Button>);
    const b = screen.getByRole("button", { name: "Run" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    const spinner = b.querySelector("svg")!;
    expect(cls(spinner)).toEqual(expect.arrayContaining(["animate-spin", "h-3.5", "w-3.5"]));
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading=false renders no spinner", () => {
    render(<Button loading={false}>Run</Button>);
    expect(screen.getByRole("button").querySelector("svg")).toBeNull();
  });

  it("disabled blocks clicks and stays disabled even when loading=false", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("type can be overridden to submit", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button type="submit">Go</Button></form>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("forwards ref and merges className (later class wins)", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref} className="h-12 extra">x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    const c = cls(ref.current!);
    expect(c).toContain("extra");
    expect(c).toContain("h-12");
    expect(c).not.toContain("h-9");
  });

  it("passes through aria attributes", () => {
    render(<Button aria-pressed="true" aria-label="Toggle">x</Button>);
    expect(screen.getByRole("button", { name: "Toggle" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("T03 Card", () => {
  it("Card has the bordered surface classes and passes props", () => {
    render(<Card data-testid="c" className="extra">body</Card>);
    expect(cls(screen.getByTestId("c"))).toEqual(expect.arrayContaining(["rounded-lg", "border", "border-border", "bg-card", "text-card-foreground", "extra"]));
    expect(cls(screen.getByTestId("c")).some((k) => k.startsWith("shadow"))).toBe(false);
  });

  it("CardHeader renders title, description and actions", () => {
    const { container } = render(<CardHeader title="Positions" description="Open lots" actions={<button>Refresh</button>} />);
    const title = screen.getByText("Positions");
    expect(cls(title)).toEqual(expect.arrayContaining(["text-sm", "font-semibold"]));
    expect(cls(screen.getByText("Open lots"))).toEqual(expect.arrayContaining(["text-[13px]", "text-muted-foreground"]));
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(cls(container.firstElementChild!)).toEqual(expect.arrayContaining(["flex", "items-start", "justify-between", "gap-4", "px-4", "pt-4"]));
  });

  it("CardHeader without description or actions renders only the title", () => {
    const { container } = render(<CardHeader title="Only" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("Only");
  });

  it("CardBody pads with p-4 and accepts className", () => {
    render(<CardBody data-testid="b" className="p-5">x</CardBody>);
    const c = cls(screen.getByTestId("b"));
    expect(c).toContain("p-5");
    expect(c).not.toContain("p-4");
  });
});

describe("T03 Badge", () => {
  it.each([
    ["success", ["bg-success/12", "text-success"]],
    ["danger", ["bg-danger/12", "text-danger"]],
    ["warning", ["bg-warning/12", "text-warning"]],
    ["info", ["bg-info/12", "text-info"]],
    ["neutral", ["bg-muted", "text-muted-foreground"]],
  ] as const)("tone %s", (tone, expected) => {
    render(<Badge tone={tone}>t</Badge>);
    expect(cls(screen.getByText("t"))).toEqual(expect.arrayContaining([...expected, "inline-flex", "rounded-sm", "px-1.5", "py-0.5", "text-xs", "font-medium"]));
  });

  it("defaults to neutral and renders a span", () => {
    render(<Badge className="extra">d</Badge>);
    const el = screen.getByText("d");
    expect(el.tagName).toBe("SPAN");
    expect(cls(el)).toEqual(expect.arrayContaining(["bg-muted", "text-muted-foreground", "extra"]));
  });
});

describe("T03 form controls", () => {
  const base = ["h-9", "w-full", "rounded-md", "border", "border-border", "bg-background", "px-3", "text-sm", "placeholder:text-muted-foreground", "focus-visible:ring-2"];

  it("Input forwards ref, has control classes and accepts typing", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<Input ref={ref} aria-label="qty" placeholder="0" onChange={onChange} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(cls(ref.current!)).toEqual(expect.arrayContaining(base));
    fireEvent.change(ref.current!, { target: { value: "12" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("Input disabled state", () => {
    render(<Input aria-label="x" disabled />);
    expect(screen.getByLabelText("x")).toBeDisabled();
    expect(cls(screen.getByLabelText("x"))).toContain("disabled:opacity-50");
  });

  it("Select forwards ref, has control classes and options", () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select ref={ref} aria-label="side" defaultValue="sell"><option value="buy">Buy</option><option value="sell">Sell</option></Select>);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    expect(cls(ref.current!)).toEqual(expect.arrayContaining(base));
    expect(ref.current!.value).toBe("sell");
  });

  it("Textarea forwards ref and is not stuck at h-9", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="notes" className="extra" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    const c = cls(ref.current!);
    expect(c).toEqual(expect.arrayContaining(["rounded-md", "border-border", "extra"]));
    expect(c).not.toContain("h-9");
  });

  it("className overrides conflicting control classes", () => {
    render(<Input aria-label="x" className="h-8" />);
    const c = cls(screen.getByLabelText("x"));
    expect(c).toContain("h-8");
    expect(c).not.toContain("h-9");
  });
});

describe("T03 Field", () => {
  it("associates the label with the control via htmlFor", () => {
    render(<Field label="Symbol" htmlFor="sym"><Input id="sym" /></Field>);
    const input = screen.getByLabelText("Symbol");
    expect(input.id).toBe("sym");
    const label = screen.getByText("Symbol");
    expect(label.tagName).toBe("LABEL");
    expect(cls(label)).toEqual(expect.arrayContaining(["text-[13px]", "font-medium"]));
  });

  it("shows the hint when there is no error, and no alert", () => {
    render(<Field label="L" htmlFor="i" hint="Use a ticker"><Input id="i" /></Field>);
    expect(cls(screen.getByText("Use a ticker"))).toEqual(expect.arrayContaining(["text-xs", "text-muted-foreground"]));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the error with role=alert in danger and hides the hint", () => {
    render(<Field label="L" htmlFor="i" hint="Use a ticker" error="Required"><Input id="i" /></Field>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Required");
    expect(cls(alert)).toEqual(expect.arrayContaining(["text-xs", "text-danger"]));
    expect(screen.queryByText("Use a ticker")).toBeNull();
  });

  it("works without htmlFor (label still rendered) and with empty error", () => {
    render(<Field label="Free" error=""><span>child</span></Field>);
    expect(screen.getByText("Free").tagName).toBe("LABEL");
    expect(screen.getByText("child")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("T03 Tabs", () => {
  const tabs = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta", badge: <span>3</span> }, { id: "c", label: "Gamma" }];

  function setup(value = "a") {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value={value} onChange={onChange} aria-label="Sections" />);
    return onChange;
  }

  it("renders a labelled tablist with tabs and aria-selected", () => {
    setup("b");
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument();
    const all = screen.getAllByRole("tab");
    expect(all).toHaveLength(3);
    expect(all.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(all.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("active tab has the underline indicator, inactive tabs are transparent; no pills", () => {
    setup("a");
    const [a, b] = screen.getAllByRole("tab");
    expect(cls(a)).toEqual(expect.arrayContaining(["border-b-2", "border-primary"]));
    expect(cls(b)).toContain("border-transparent");
    for (const t of screen.getAllByRole("tab")) expect(cls(t)).not.toContain("rounded-full");
  });

  it("renders the badge inside the tab", () => {
    setup();
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveTextContent("Beta3");
  });

  it("click calls onChange with the id", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it.each([
    ["a", "ArrowRight", "b", 1],
    ["c", "ArrowRight", "a", 0],
    ["a", "ArrowLeft", "c", 2],
    ["b", "ArrowLeft", "a", 0],
    ["b", "Home", "a", 0],
    ["a", "End", "c", 2],
  ])("from %s, %s selects %s and moves focus", (from, key, to, idx) => {
    const onChange = setup(from);
    const current = screen.getByRole("tab", { selected: true });
    current.focus();
    fireEvent.keyDown(current, { key });
    expect(onChange).toHaveBeenCalledWith(to);
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[idx]);
  });

  it.each(["ArrowUp", "ArrowDown", "Enter", "a", "Tab"])("ignores %s", (key) => {
    const onChange = setup("a");
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("arrow key navigation prevents default scrolling", () => {
    setup("a");
    const tab = screen.getAllByRole("tab")[0];
    const ev = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    tab.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("a single tab wraps to itself", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[{ id: "only", label: "Only" }]} value="only" onChange={onChange} aria-label="x" />);
    fireEvent.keyDown(screen.getByRole("tab"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("only");
  });

  it("an empty tab list renders an empty tablist", () => {
    render(<Tabs tabs={[]} value="" onChange={() => {}} aria-label="Empty" />);
    expect(screen.getByRole("tablist", { name: "Empty" })).toBeEmptyDOMElement();
  });

  it("a value matching no tab leaves every tab unselected", () => {
    setup("zzz");
    expect(screen.queryByRole("tab", { selected: true })).toBeNull();
  });
});

describe("T03 PageHeader and Page", () => {
  it("PageHeader renders an h1 with the page title style, description and actions", () => {
    const { container } = render(<PageHeader title="Paper trading" description="Simulated" actions={<button>New</button>} />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Paper trading" });
    expect(cls(h1)).toEqual(expect.arrayContaining(["text-xl", "font-semibold", "tracking-tight"]));
    expect(cls(screen.getByText("Simulated"))).toEqual(expect.arrayContaining(["text-[13px]", "text-muted-foreground"]));
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(cls(container.firstElementChild!)).toEqual(expect.arrayContaining(["flex", "flex-wrap", "justify-between"]));
  });

  it("PageHeader with only a title", () => {
    const { container } = render(<PageHeader title="T" />);
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it.each([
    ["narrow", "max-w-6xl"],
    ["wide", "max-w-[1400px]"],
    [undefined, "max-w-[1400px]"],
  ] as const)("Page width=%s uses %s", (width, expected) => {
    const { container } = render(<Page width={width}>x</Page>);
    expect(cls(container.firstElementChild!)).toEqual(expect.arrayContaining([
      expected, "mx-auto", "w-full", "px-4", "py-4", "md:px-6", "md:py-6", "space-y-6",
    ]));
  });

  it("Page width=full has no max width", () => {
    const { container } = render(<Page width="full">x</Page>);
    expect(cls(container.firstElementChild!).some((k) => k.startsWith("max-w"))).toBe(false);
  });
});

describe("T03 Stat", () => {
  it.each([
    ["success", "text-success"],
    ["danger", "text-danger"],
    ["neutral", "text-foreground"],
  ] as const)("tone %s colors the value with %s", (tone, expected) => {
    render(<Stat label="P&L" value="+1.2%" tone={tone} />);
    const v = screen.getByText("+1.2%");
    expect(cls(v)).toEqual(expect.arrayContaining([expected, "text-2xl", "font-semibold", "tabular-nums"]));
  });

  it("defaults to neutral, label is caption style, hint optional", () => {
    const { rerender } = render(<Stat label="Equity" value="100" />);
    expect(cls(screen.getByText("100"))).toContain("text-foreground");
    expect(cls(screen.getByText("100"))).not.toContain("text-success");
    expect(cls(screen.getByText("Equity"))).toEqual(expect.arrayContaining(["text-xs", "text-muted-foreground"]));
    expect(screen.queryByText("since start")).toBeNull();
    rerender(<Stat label="Equity" value="100" hint="since start" />);
    expect(cls(screen.getByText("since start"))).toEqual(expect.arrayContaining(["text-xs", "text-muted-foreground"]));
  });

  it("renders a zero value", () => {
    render(<Stat label="Trades" value={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

describe("T03 EmptyState", () => {
  it("renders icon at 20px, title and description, action", () => {
    const { container } = render(<EmptyState icon={Inbox} title="No trades" description="Run a strategy" action={<button>Start</button>} />);
    const svg = container.querySelector("svg")!;
    expect(cls(svg)).toEqual(expect.arrayContaining(["h-5", "w-5", "text-muted-foreground"]));
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(cls(screen.getByText("No trades"))).toEqual(expect.arrayContaining(["text-sm", "font-semibold"]));
    expect(screen.getByText("Run a strategy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(cls(container.firstElementChild!)).toEqual(expect.arrayContaining(["items-center", "text-center"]));
  });

  it("works with only a title", () => {
    const { container } = render(<EmptyState title="Nothing" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("Nothing");
  });
});

describe("T03 Table", () => {
  function table() {
    return render(
      <Table data-testid="t">
        <THead><TR><TH>Symbol</TH><TH numeric>Qty</TH><TH align="right">Side</TH></TR></THead>
        <TBody><TR data-testid="row"><TD>BTC</TD><TD numeric>1.5</TD><TD align="right">Buy</TD><TD align="left">x</TD></TR></TBody>
      </Table>,
    );
  }

  it("wraps the table in a scrollable rounded border", () => {
    table();
    const t = screen.getByTestId("t");
    expect(t.tagName).toBe("TABLE");
    expect(cls(t.parentElement!)).toEqual(expect.arrayContaining(["overflow-x-auto", "rounded-lg", "border"]));
  });

  it("header row is muted, small and not uppercase", () => {
    const { container } = table();
    const thead = container.querySelector("thead")!;
    expect(cls(thead)).toEqual(expect.arrayContaining(["bg-muted/60", "text-xs", "font-medium", "text-muted-foreground"]));
    expect(thead.outerHTML).not.toMatch(/uppercase/);
  });

  it("numeric cells are right aligned and tabular", () => {
    table();
    for (const el of [screen.getByText("Qty"), screen.getByText("1.5")]) {
      expect(cls(el)).toEqual(expect.arrayContaining(["text-right", "tabular-nums"]));
      expect(cls(el)).not.toContain("text-left");
    }
  });

  it("align=right is right aligned without tabular-nums; default is left", () => {
    table();
    for (const el of [screen.getByText("Side"), screen.getByText("Buy")]) {
      expect(cls(el)).toContain("text-right");
      expect(cls(el)).not.toContain("tabular-nums");
    }
    for (const el of [screen.getByText("Symbol"), screen.getByText("BTC"), screen.getByText("x")]) {
      expect(cls(el)).toContain("text-left");
      expect(cls(el)).not.toContain("text-right");
    }
  });

  it("cells are px-3 py-2 text-sm and rows hover", () => {
    table();
    expect(cls(screen.getByText("BTC"))).toEqual(expect.arrayContaining(["px-3", "py-2", "text-sm"]));
    expect(cls(screen.getByText("Symbol"))).toEqual(expect.arrayContaining(["px-3", "py-2"]));
    expect(cls(screen.getByTestId("row"))).toContain("hover:bg-muted/40");
  });

  it("TD className can override alignment", () => {
    render(<table><tbody><tr><TD numeric className="text-left">n</TD></tr></tbody></table>);
    const c = cls(screen.getByText("n"));
    expect(c).toContain("text-left");
    expect(c).not.toContain("text-right");
    expect(c).toContain("tabular-nums");
  });
});

describe("T03 Skeleton", () => {
  it("uses bg-muted animate-pulse rounded-md", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(cls(container.firstElementChild!)).toEqual(expect.arrayContaining(["bg-muted", "animate-pulse", "rounded-md", "h-4"]));
  });
});
