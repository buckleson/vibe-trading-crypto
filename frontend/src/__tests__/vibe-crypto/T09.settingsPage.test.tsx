// T09: Settings page structure (Card sections, sub-navigation, Claude section,
// no app API key), secret inputs, save buttons, and unchanged desktop
// credential IPC usage. Offline: api, claudeChat and heavy children are mocked.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { Settings } from "@/pages/Settings";

const apiMock = vi.hoisted(() => ({
  getLLMSettings: vi.fn(),
  getDataSourceSettings: vi.fn(),
  listLLMModels: vi.fn(),
  updateLLMSettings: vi.fn(),
  updateDataSourceSettings: vi.fn(),
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock, isAuthRequiredError: vi.fn(() => false) };
});

const claudeMock = vi.hoisted(() => ({ getClaudeStatus: vi.fn() }));
vi.mock("@/lib/claudeChat", () => ({ getClaudeStatus: claudeMock.getClaudeStatus }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/components/settings/ChannelSettings", () => ({
  ChannelSettings: () => <div data-testid="channel-settings" />,
}));
vi.mock("@/components/settings/SourcePrioritySettings", () => ({
  SourcePrioritySettings: () => <div data-testid="source-priority" />,
}));
vi.mock("@/components/settings/CustomProviderManager", () => ({
  CustomProviderManager: () => <div data-testid="custom-providers" />,
}));

const providers = [
  {
    name: "openrouter", label: "OpenRouter", api_key_env: "OPENROUTER_API_KEY", base_url_env: "OPENROUTER_BASE_URL",
    default_model: "deepseek/deepseek-v3.2", default_base_url: "https://openrouter.ai/api/v1",
    api_key_required: true, auth_type: "api_key", reasoning_efforts: ["low", "high"],
  },
  {
    name: "ollama", label: "Ollama", api_key_env: null, base_url_env: "OLLAMA_BASE_URL",
    default_model: "llama3", default_base_url: "http://localhost:11434/v1",
    api_key_required: false, auth_type: "api_key", reasoning_efforts: [],
  },
];

function llmSettings(over: Record<string, unknown> = {}) {
  return {
    provider: "openrouter", model_name: "deepseek/deepseek-v3.2", base_url: "https://openrouter.ai/api/v1",
    api_key_env: "OPENROUTER_API_KEY", api_key_configured: false, api_key_required: true,
    temperature: 0, timeout_seconds: 120, max_retries: 2, reasoning_effort: "",
    sse_timeout_seconds: 300, env_path: "agent/.env", providers, ...over,
  };
}

const dataSettings = {
  tushare_token_configured: false, gildata_token_configured: false, gildata_features: [],
  baostock_supported: true, baostock_installed: true, baostock_message: "ok", env_path: "agent/.env",
};

type Observed = { cb: IntersectionObserverCallback; nodes: Element[] };
let observers: Observed[] = [];

class FakeIO {
  private rec: Observed;
  constructor(cb: IntersectionObserverCallback) { this.rec = { cb, nodes: [] }; observers.push(this.rec); }
  observe(node: Element) { this.rec.nodes.push(node); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => {
  vi.clearAllMocks();
  observers = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  apiMock.getLLMSettings.mockResolvedValue(llmSettings());
  apiMock.getDataSourceSettings.mockResolvedValue(dataSettings);
  apiMock.listLLMModels.mockResolvedValue({ provider: "openrouter", models: [], source: "provider", warning_code: null });
  claudeMock.getClaudeStatus.mockResolvedValue({ available: true, sdk_version: "1", auth: "api_key", model: null, error: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { vibeDesktop?: unknown }).vibeDesktop;
});

async function renderLoaded() {
  render(<Settings />);
  await screen.findByRole("heading", { name: "LLM Settings" });
}

const NAV_NAME = "Settings sections";

describe("Settings layout", () => {
  it("has a Settings page header", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("renders the sub-navigation in the specified order without Desktop on the web", async () => {
    await renderLoaded();
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    const links = within(nav).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Model", "Claude", "Data sources", "Custom providers", "Channels"]);
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^#settings-/);
      expect(link.className).toMatch(/text-\[13px\]/);
    }
  });

  it("nav is hidden below lg and sticky on lg", async () => {
    await renderLoaded();
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    expect(nav.className).toMatch(/hidden/);
    expect(nav.className).toMatch(/lg:block/);
    expect(nav.querySelector(".sticky")).not.toBeNull();
  });

  it("every nav link targets an existing section in the same order as the DOM", async () => {
    await renderLoaded();
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    const ids = within(nav).getAllByRole("link").map((a) => a.getAttribute("href")!.slice(1));
    const sections = ids.map((id) => document.getElementById(id));
    sections.forEach((el, i) => expect(el, ids[i]).not.toBeNull());
    for (let i = 1; i < sections.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING = 4
      expect(sections[i - 1]!.compareDocumentPosition(sections[i]!) & 4).toBe(4);
    }
  });

  it("marks Model active initially and switches the highlight on click, scrolling to the section", async () => {
    await renderLoaded();
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    expect(within(nav).getByRole("link", { name: "Model" })).toHaveAttribute("aria-current", "true");
    const target = document.getElementById("settings-channels")!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    fireEvent.click(within(nav).getByRole("link", { name: "Channels" }));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(within(nav).getByRole("link", { name: "Channels" })).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("link", { name: "Model" })).not.toHaveAttribute("aria-current");
  });

  it("click on a link does not change the location hash (default prevented)", async () => {
    await renderLoaded();
    const before = window.location.hash;
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    fireEvent.click(within(nav).getByRole("link", { name: "Claude" }));
    expect(window.location.hash).toBe(before);
  });

  it("IntersectionObserver updates the active section while scrolling", async () => {
    await renderLoaded();
    await waitFor(() => expect(observers.length).toBeGreaterThan(0));
    const last = observers[observers.length - 1];
    expect(last.nodes.map((n) => n.id)).toEqual([
      "settings-model", "settings-claude", "settings-data", "settings-providers", "settings-channels",
    ]);
    const claude = document.getElementById("settings-claude")!;
    act(() => {
      last.cb([{ isIntersecting: true, target: claude } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    expect(within(nav).getByRole("link", { name: "Claude" })).toHaveAttribute("aria-current", "true");
  });

  it("ignores IntersectionObserver entries that are not intersecting", async () => {
    await renderLoaded();
    await waitFor(() => expect(observers.length).toBeGreaterThan(0));
    const last = observers[observers.length - 1];
    act(() => {
      last.cb([{ isIntersecting: false, target: document.getElementById("settings-data")! } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    expect(within(nav).getByRole("link", { name: "Model" })).toHaveAttribute("aria-current", "true");
  });

  it("renders without IntersectionObserver (old webviews)", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await renderLoaded();
    expect(screen.getByRole("navigation", { name: NAV_NAME })).toBeInTheDocument();
  });

  it("each section holds its expected content", async () => {
    await renderLoaded();
    expect(within(document.getElementById("settings-model")!).getByRole("heading", { name: "LLM Settings" })).toBeInTheDocument();
    expect(within(document.getElementById("settings-claude")!).getByRole("heading", { name: "Claude" })).toBeInTheDocument();
    const data = document.getElementById("settings-data")!;
    expect(within(data).getByRole("heading", { name: "Data Source Settings" })).toBeInTheDocument();
    expect(within(data).getByTestId("source-priority")).toBeInTheDocument();
    expect(within(document.getElementById("settings-providers")!).getByTestId("custom-providers")).toBeInTheDocument();
    expect(within(document.getElementById("settings-channels")!).getByTestId("channel-settings")).toBeInTheDocument();
    expect(document.getElementById("settings-desktop")).toBeNull();
  });

  it("the Claude section shows live status from getClaudeStatus and the MCP command", async () => {
    await renderLoaded();
    const claude = document.getElementById("settings-claude")!;
    expect(await within(claude).findByText("Connected")).toBeInTheDocument();
    expect(within(claude).getByText("claude mcp add vibe-crypto -- vibe-crypto-mcp")).toBeInTheDocument();
    expect(within(claude).getByRole("link", { name: /Setup guide/ })).toBeInTheDocument();
  });

  it("has no app API auth key field (ADR 0002)", async () => {
    await renderLoaded();
    expect(screen.queryByText(/API Auth Key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/auth key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("settings.authRequired"))).not.toBeInTheDocument();
  });
});

describe("Settings desktop section", () => {
  function installDesktop() {
    const desktop = {
      isDesktop: true,
      restartBackend: vi.fn().mockResolvedValue(true),
      getCredentialStatus: vi.fn().mockResolvedValue({ available: true, configured: [], migrated: [] }),
      setCredential: vi.fn().mockResolvedValue({ available: true, configured: ["OPENROUTER_API_KEY"], migrated: [] }),
    };
    (window as unknown as { vibeDesktop: typeof desktop }).vibeDesktop = desktop;
    return desktop;
  }

  it("shows the Desktop nav link and section last when running in the desktop app", async () => {
    installDesktop();
    await renderLoaded();
    const nav = screen.getByRole("navigation", { name: NAV_NAME });
    const links = within(nav).getAllByRole("link").map((a) => a.textContent);
    expect(links.at(-1)).toBe("Desktop");
    const section = document.getElementById("settings-desktop")!;
    expect(within(section).getByRole("heading", { name: "Desktop" })).toBeInTheDocument();
  });

  it("hides the Desktop section when vibeDesktop exists but isDesktop is false", async () => {
    (window as unknown as { vibeDesktop: unknown }).vibeDesktop = { isDesktop: false };
    await renderLoaded();
    expect(document.getElementById("settings-desktop")).toBeNull();
  });

  it("stores the LLM key through desktop IPC, not the HTTP body, then restarts the backend", async () => {
    const desktop = installDesktop();
    apiMock.updateLLMSettings.mockResolvedValue(llmSettings({ api_key_configured: true }));
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "  sk-or-123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(desktop.restartBackend).toHaveBeenCalled());
    expect(apiMock.updateLLMSettings).toHaveBeenCalledWith(expect.objectContaining({ api_key: undefined, clear_api_key: false }));
    expect(desktop.setCredential).toHaveBeenCalledWith("OPENROUTER_API_KEY", "sk-or-123");
    expect(toastMock.success).toHaveBeenCalledWith("LLM settings saved");
    expect(toastMock.info).toHaveBeenCalled();
  });

  it("clearing the key on desktop sends null to setCredential", async () => {
    const desktop = installDesktop();
    apiMock.updateLLMSettings.mockResolvedValue(llmSettings());
    await renderLoaded();
    fireEvent.click(screen.getByLabelText("Clear saved API key"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(desktop.setCredential).toHaveBeenCalledWith("OPENROUTER_API_KEY", null));
  });

  it("saving without a key change does not touch desktop credentials or restart", async () => {
    const desktop = installDesktop();
    apiMock.updateLLMSettings.mockResolvedValue(llmSettings());
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(desktop.setCredential).not.toHaveBeenCalled();
    expect(desktop.restartBackend).not.toHaveBeenCalled();
  });

  it("data-source tokens go to desktop IPC under their env names", async () => {
    const desktop = installDesktop();
    apiMock.updateDataSourceSettings.mockResolvedValue(dataSettings);
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("Tushare token"), { target: { value: "tu-1" } });
    fireEvent.change(screen.getByLabelText("Gildata token"), { target: { value: "gd-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save data source settings" }));
    await waitFor(() => expect(desktop.restartBackend).toHaveBeenCalledTimes(1));
    expect(desktop.setCredential).toHaveBeenCalledWith("TUSHARE_TOKEN", "tu-1");
    expect(desktop.setCredential).toHaveBeenCalledWith("GILDATA_TOKEN", "gd-1");
    expect(apiMock.updateDataSourceSettings).toHaveBeenCalledWith(expect.objectContaining({
      tushare_token: undefined, gildata_token: undefined, clear_tushare_token: false, clear_gildata_token: false,
    }));
  });
});

describe("Settings forms on the web", () => {
  it("sends the trimmed API key in the HTTP body and clears the field after save", async () => {
    apiMock.updateLLMSettings.mockResolvedValue(llmSettings({ api_key_configured: true }));
    await renderLoaded();
    const input = screen.getByLabelText("API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: " sk-1 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.updateLLMSettings).toHaveBeenCalledWith(expect.objectContaining({ api_key: "sk-1" })));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("an empty key is sent as undefined (keeps the current key)", async () => {
    apiMock.updateLLMSettings.mockResolvedValue(llmSettings());
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.updateLLMSettings).toHaveBeenCalledWith(expect.objectContaining({ api_key: undefined })));
  });

  it("all secret fields are password inputs with a show/hide toggle", async () => {
    await renderLoaded();
    for (const label of ["API key", "Tushare token", "Gildata token"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
    }
    expect(screen.getAllByRole("button", { name: "Show value" }).length).toBeGreaterThanOrEqual(3);
  });

  it("the API key field is disabled for a provider that needs no key", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "ollama" } });
    expect(screen.getByLabelText("API key")).toBeDisabled();
    expect(screen.queryByLabelText("Clear saved API key")).not.toBeInTheDocument();
  });

  it("checking clear empties and disables the API key field", async () => {
    await renderLoaded();
    const input = screen.getByLabelText("API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-x" } });
    fireEvent.click(screen.getByLabelText("Clear saved API key"));
    expect(input.value).toBe("");
    expect(input).toBeDisabled();
  });

  it("each form has exactly one primary submit button, right-aligned", async () => {
    await renderLoaded();
    for (const id of ["settings-model", "settings-data"]) {
      const form = document.getElementById(id)!.querySelector("form")!;
      const submits = form.querySelectorAll('button[type="submit"]');
      expect(submits).toHaveLength(1);
      expect(submits[0].className).toMatch(/bg-primary/);
      expect(submits[0].parentElement!.className).toMatch(/justify-(between|end)/);
    }
  });

  it("shows a loading state on the save button while saving", async () => {
    let resolve!: (v: unknown) => void;
    apiMock.updateLLMSettings.mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saving = await screen.findByRole("button", { name: /Saving/ });
    expect(saving).toBeDisabled();
    await act(async () => { resolve(llmSettings()); });
    expect(await screen.findByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("reports a save failure via the error toast and re-enables the button", async () => {
    apiMock.updateLLMSettings.mockRejectedValue(new Error("boom"));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Failed to save LLM settings: boom"));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("Settings load states", () => {
  it("shows a loading card before data arrives", () => {
    apiMock.getLLMSettings.mockReturnValue(new Promise(() => {}));
    render(<Settings />);
    expect(screen.getByText(i18n.t("settings.loading"))).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: NAV_NAME })).not.toBeInTheDocument();
  });

  it("shows an inline alert with the message when LLM settings fail to load", async () => {
    apiMock.getLLMSettings.mockRejectedValue(new Error("backend down"));
    render(<Settings />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("backend down");
    expect(screen.getByText(i18n.t("settings.unavailable"))).toBeInTheDocument();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it("shows an inline alert when only the data source settings fail", async () => {
    apiMock.getDataSourceSettings.mockRejectedValue(new Error("ds down"));
    render(<Settings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ds down");
  });
});
