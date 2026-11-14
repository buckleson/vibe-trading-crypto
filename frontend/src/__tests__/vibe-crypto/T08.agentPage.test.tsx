// T08: Agent page layout after the redesign. Rendered with mocked api and SSE;
// no network, no real backend.
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { Agent } from "@/pages/Agent";
import { useAgentStore } from "@/stores/agent";

const apiMock = vi.hoisted(() => ({
  getGoal: vi.fn(),
  getLLMSettings: vi.fn(),
  getRunPreview: vi.fn(),
  getSessionMessages: vi.fn(),
  sseUrl: vi.fn((sid: string) => `/sessions/${sid}/events`),
}));
const sseMock = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), onStatusChange: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock };
});
vi.mock("@/hooks/useSSE", () => ({ useSSE: () => sseMock }));
vi.mock("@/components/chat/ModelRuntimeBar", () => ({ ModelRuntimeBar: () => <output data-testid="runtime-bar" /> }));

beforeAll(async () => { await i18n.changeLanguage("en"); });

beforeEach(() => {
  useAgentStore.getState().reset?.();
  apiMock.getLLMSettings.mockResolvedValue({});
  apiMock.getGoal.mockResolvedValue(null);
  apiMock.getSessionMessages.mockResolvedValue([]);
  apiMock.getRunPreview.mockResolvedValue(null);
});

function renderAgent(path = "/") {
  const router = createMemoryRouter([{ path: "/", element: <Agent /> }], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe("T08 Agent page layout", () => {
  it("new conversation shows the welcome hero inside a centered max-w-3xl column", async () => {
    renderAgent();
    const h1 = await screen.findByRole("heading", { level: 1 });
    const column = h1.closest(".max-w-3xl")!;
    expect(column).not.toBeNull();
    expect(column).toHaveClass("mx-auto", "px-4");
    expect(h1.className).not.toMatch(/font-serif/);
  });

  it("composer sits in its own centered max-w-3xl column", async () => {
    renderAgent();
    const box = await screen.findByRole("textbox", { name: "Message to the agent" });
    const column = box.closest(".max-w-3xl")!;
    expect(column).toHaveClass("mx-auto", "px-4");
    expect(box.closest("[data-agent-composer]")).not.toBeNull();
  });

  it("page itself is full width: no Page wrapper max-width around the scroll area", async () => {
    const { container } = renderAgent();
    await screen.findByRole("heading", { level: 1 });
    const scroll = container.querySelector(".chat-scroll-container")!;
    expect(scroll).not.toBeNull();
    let el: Element | null = scroll.parentElement;
    while (el && el !== container) {
      expect(el.className).not.toMatch(/\bmax-w-(screen-\w+|[4-7]xl|6xl|7xl)\b/);
      el = el.parentElement;
    }
  });

  it("no backdrop blur, gradients or pulsing dots on the empty agent page", async () => {
    const { container } = renderAgent();
    await screen.findByRole("heading", { level: 1 });
    const classes = Array.from(container.querySelectorAll("*")).map((e) => e.getAttribute("class") ?? "").join(" ");
    expect(classes).not.toMatch(/backdrop-blur|bg-gradient|animate-pulse|animate-ping|font-serif|\buppercase\b/);
  });

  it("does not open an SSE connection before a session exists", async () => {
    renderAgent();
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(apiMock.getLLMSettings).toHaveBeenCalled());
    expect(sseMock.connect).not.toHaveBeenCalled();
    expect(apiMock.getSessionMessages).not.toHaveBeenCalled();
  });
});
