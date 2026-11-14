import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "@/i18n";
import { TopBar } from "../TopBar";
import { pageTitleKey } from "../navigation";

beforeAll(async () => { await i18n.changeLanguage("en"); });

function renderAt(path: string, dockOpen = false) {
  return render(<MemoryRouter initialEntries={[path]}><TopBar dockOpen={dockOpen} onToggleDock={() => {}} /></MemoryRouter>);
}

describe("TopBar", () => {
  it("shows the page title for the active route", () => {
    const { unmount } = renderAt("/");
    expect(screen.getByRole("heading", { name: "Research assistant" })).toBeInTheDocument();
    unmount();
    const second = renderAt("/paper-trading");
    expect(screen.getByRole("heading", { name: "Paper trading" })).toBeInTheDocument();
    second.unmount();
    renderAt("/runs/abc");
    expect(screen.getByRole("heading", { name: /Run/ })).toBeInTheDocument();
  });

  it("exposes the Claude toggle state, theme toggle and language menu", () => {
    renderAt("/", true);
    expect(screen.getByRole("button", { name: /Claude/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Language" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("pageTitleKey", () => {
  it("maps routes", () => {
    expect(pageTitleKey("/alpha-zoo/bench").key).toBe("layout.alphaZoo");
    expect(pageTitleKey("/settings").key).toBe("layout.settings");
    expect(pageTitleKey("/compare")).toEqual({ key: "layout.compare", fallback: "Compare runs" });
    expect(pageTitleKey("/about")).toEqual({ key: "layout.about", fallback: "About" });
    expect(pageTitleKey("/nowhere")).toEqual({ key: "layout.app", fallback: "Vibe Crypto" });
  });
});
