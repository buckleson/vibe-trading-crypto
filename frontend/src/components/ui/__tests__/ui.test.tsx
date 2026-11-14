import { fireEvent, render, screen } from "@testing-library/react";
import { Button, Field, Input, Stat, Table, THead, TBody, TR, TH, TD, Tabs } from "..";

describe("Button", () => {
  it("defaults to secondary and type=button", () => {
    render(<Button>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveClass("bg-card", "h-9");
  });
  it("applies variants and sizes", () => {
    render(<><Button variant="primary" size="sm">P</Button><Button variant="danger">D</Button><Button variant="ghost" size="icon" aria-label="g" /></>);
    expect(screen.getByText("P")).toHaveClass("bg-primary", "h-8");
    expect(screen.getByText("D")).toHaveClass("bg-destructive");
    expect(screen.getByLabelText("g")).toHaveClass("w-9");
  });
  it("loading disables and sets aria-busy", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Run</Button>);
    const b = screen.getByRole("button", { name: "Run" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
  it("disabled does not fire click", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>X</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Tabs", () => {
  it("navigates with arrow keys and reports changes", () => {
    const onChange = vi.fn();
    render(<Tabs aria-label="Dock" tabs={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} value="a" onChange={onChange} />);
    const a = screen.getByRole("tab", { name: "A" });
    expect(a).toHaveAttribute("aria-selected", "true");
    expect(a).toHaveClass("border-primary");
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("b");
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(onChange).toHaveBeenLastCalledWith("b");
  });
});

describe("Field", () => {
  it("associates label and exposes error as alert", () => {
    render(<Field label="Name" htmlFor="n" error="Required"><Input id="n" /></Field>);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});

describe("Stat", () => {
  it("colors the value by tone", () => {
    render(<Stat label="P&L" value="+12" tone="success" />);
    expect(screen.getByText("+12")).toHaveClass("text-success", "tabular-nums");
  });
});

describe("Table", () => {
  it("right-aligns numeric cells with tabular numbers", () => {
    render(<Table><THead><TR><TH numeric>Qty</TH></TR></THead><TBody><TR><TD numeric>5</TD></TR></TBody></Table>);
    expect(screen.getByText("5")).toHaveClass("text-right", "tabular-nums");
    expect(screen.getByText("Qty")).toHaveClass("text-right");
  });
});
