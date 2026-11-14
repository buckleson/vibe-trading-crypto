import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

vi.mock("@/components/claude/ChatPanel", () => ({ ChatPanel: () => <div>chat panel</div> }));
vi.mock("@/components/terminal/TerminalPanel", () => ({
  terminalAvailable: vi.fn(() => false),
  TerminalPanel: () => <div>terminal panel</div>,
}));
vi.mock("@/lib/api", () => ({ api: { listSessions: vi.fn().mockResolvedValue([]) } }));

import { Layout } from "../Layout";
import { AssistantDock } from "../AssistantDock";
import { terminalAvailable } from "@/components/terminal/TerminalPanel";

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/about"]}>
      <LayoutWithRoutes />
    </MemoryRouter>,
  );
}
import { Route, Routes } from "react-router";
function LayoutWithRoutes() {
  return <Routes><Route element={<Layout />}><Route path="/about" element={<div>about</div>} /></Route></Routes>;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(terminalAvailable).mockReturnValue(false);
});

describe("AssistantDock in the layout", () => {
  it("toggles with the top bar button and reflects aria-pressed", async () => {
    renderLayout();
    const toggle = screen.getByRole("button", { name: /Claude/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("dock-panel-chat")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("chat panel")).toBeInTheDocument();
    expect(window.localStorage.getItem("vc-dock-open")).toBe("1");
  });

  it("toggles with Ctrl+J", async () => {
    renderLayout();
    const toggle = screen.getByRole("button", { name: /Claude/ });
    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(document, { key: "J", metaKey: true });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the chat panel mounted after closing", async () => {
    renderLayout();
    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    await screen.findByText("chat panel");
    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    const panel = screen.getByTestId("dock-panel-chat", { hidden: true } as never);
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("chat panel", { selector: "div" })).toBeInTheDocument();
    expect(panel.closest("aside")).toHaveAttribute("hidden");
  });
});

describe("AssistantDock tabs", () => {
  it("hides the Terminal tab when the terminal is unavailable", async () => {
    render(<AssistantDock open onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Terminal" })).not.toBeInTheDocument();
  });

  it("shows the Terminal tab and keeps both panels mounted when available", async () => {
    vi.mocked(terminalAvailable).mockReturnValue(true);
    render(<AssistantDock open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    await screen.findByText("terminal panel");
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    await waitFor(() => expect(screen.getByTestId("dock-panel-terminal")).toHaveAttribute("hidden"));
    expect(screen.getByText("terminal panel")).toBeInTheDocument();
    expect(window.localStorage.getItem("vc-dock-tab")).toBe("chat");
  });

  it("closes from the close button", () => {
    const onClose = vi.fn();
    render(<AssistantDock open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(onClose).toHaveBeenCalled();
  });
});
