// T09: ClaudeSettings (status states, open chat event, copy command, guide link)
// and SecretInput (show/hide). Offline: @/lib/claudeChat and sonner are mocked.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { CLAUDE_GUIDE_URL, ClaudeSettings, MCP_ADD_COMMAND } from "@/components/settings/ClaudeSettings";
import { SecretInput } from "@/components/settings/SecretInput";

const claudeMock = vi.hoisted(() => ({ getClaudeStatus: vi.fn() }));
vi.mock("@/lib/claudeChat", () => ({ getClaudeStatus: claudeMock.getClaudeStatus }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

type Auth = "api_key" | "claude_login" | "unknown";
const status = (over: Partial<{ available: boolean; auth: Auth; error: string | null }> = {}) => ({
  available: true, sdk_version: "0.1.0", auth: "api_key" as Auth, model: null, error: null, ...over,
});

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => {
  claudeMock.getClaudeStatus.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe("ClaudeSettings constants", () => {
  it("exports the exact MCP add command from the spec", () => {
    expect(MCP_ADD_COMMAND).toBe("claude mcp add vibe-crypto -- vibe-crypto-mcp");
  });

  it("points the guide at the rebranded repo's CLAUDE_CODE.md", () => {
    expect(CLAUDE_GUIDE_URL).toBe(
      "https://github.com/buckleson/vibe-trading-crypto/blob/main/docs/vibe-crypto/CLAUDE_CODE.md",
    );
  });
});

describe("ClaudeSettings status row", () => {
  it("calls getClaudeStatus exactly once on mount", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    render(<ClaudeSettings />);
    await screen.findByText("Connected");
    expect(claudeMock.getClaudeStatus).toHaveBeenCalledTimes(1);
  });

  it("shows no badge and a loading line while the status is pending", () => {
    claudeMock.getClaudeStatus.mockReturnValue(new Promise(() => {}));
    render(<ClaudeSettings />);
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs login")).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("settings.loading"))).toBeInTheDocument();
    // The rest of the card is usable while loading.
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open chat" })).toBeEnabled();
  });

  it.each<[string, Auth, string]>([
    ["api key", "api_key", "Using API key"],
    ["claude login", "claude_login", "Using your Claude login"],
  ])("Connected badge with success tone for %s auth", async (_n, auth, detail) => {
    claudeMock.getClaudeStatus.mockResolvedValue(status({ auth }));
    render(<ClaudeSettings />);
    const badge = await screen.findByText("Connected");
    expect(badge.className).toMatch(/text-success/);
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  it("Needs login badge with warning tone when available but auth is unknown", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status({ auth: "unknown" }));
    render(<ClaudeSettings />);
    const badge = await screen.findByText("Needs login");
    expect(badge.className).toMatch(/text-warning/);
    expect(screen.getByText("Set ANTHROPIC_API_KEY or log in with the claude command")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("Unavailable badge with danger tone when the SDK is not available, even with an api key", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status({ available: false, auth: "api_key" }));
    render(<ClaudeSettings />);
    const badge = await screen.findByText("Unavailable");
    expect(badge.className).toMatch(/text-danger/);
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs login")).not.toBeInTheDocument();
  });

  it("Unavailable with the setup hint when the status request fails", async () => {
    claudeMock.getClaudeStatus.mockRejectedValue(new Error("Request failed (500)"));
    render(<ClaudeSettings />);
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Set ANTHROPIC_API_KEY or log in with the claude command")).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("settings.loading"))).not.toBeInTheDocument();
  });

  it("does not update state after unmount when the status resolves late", async () => {
    let resolve!: (v: ReturnType<typeof status>) => void;
    claudeMock.getClaudeStatus.mockReturnValue(new Promise((r) => { resolve = r; }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<ClaudeSettings />);
    unmount();
    await act(async () => { resolve(status()); });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("ClaudeSettings actions", () => {
  it("Open chat dispatches vc:open-dock with the chat tab and nothing else", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    const listener = vi.fn();
    window.addEventListener("vc:open-dock", listener);
    try {
      render(<ClaudeSettings />);
      const button = await screen.findByRole("button", { name: "Open chat" });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(listener).toHaveBeenCalledTimes(2);
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.detail).toEqual({ tab: "chat" });
    } finally {
      window.removeEventListener("vc:open-dock", listener);
    }
  });

  it("Open chat is a secondary (not primary) button", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    render(<ClaudeSettings />);
    const button = await screen.findByRole("button", { name: "Open chat" });
    expect(button.className).not.toMatch(/bg-primary\b/);
  });

  it("renders the command in a mono code box", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    render(<ClaudeSettings />);
    const code = await screen.findByText(MCP_ADD_COMMAND);
    expect(code.tagName).toBe("CODE");
    expect(code.className).toMatch(/font-mono/);
    expect(code.className).toMatch(/text-\[13px\]/);
    // Long command scrolls inside its box, not the page.
    expect(code.className).toMatch(/overflow-x-auto/);
  });

  it("shows the terminal heading and the install alternative line", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    render(<ClaudeSettings />);
    expect(await screen.findByText("Use Claude Code in your terminal")).toBeInTheDocument();
    expect(screen.getByText("Or run vibe-crypto mcp install")).toBeInTheDocument();
  });

  it("copies the command, toasts success and flips the icon back after 2s", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<ClaudeSettings />);
    await screen.findByText("Connected");
    vi.useFakeTimers();
    const button = screen.getByRole("button", { name: "Copy" });
    const iconBefore = button.querySelector("svg")!.getAttribute("class");
    await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("claude mcp add vibe-crypto -- vibe-crypto-mcp");
    expect(toastMock.success).toHaveBeenCalledWith("Command copied");
    expect(toastMock.error).not.toHaveBeenCalled();
    const iconCopied = button.querySelector("svg")!.getAttribute("class");
    expect(iconCopied).not.toEqual(iconBefore);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(button.querySelector("svg")!.getAttribute("class")).toEqual(iconBefore);
  });

  it("toasts an error and does not claim success when the clipboard rejects", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<ClaudeSettings />);
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Could not copy the command"));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("toasts an error when the clipboard API is missing entirely", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<ClaudeSettings />);
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("Setup guide opens externally with a safe rel", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status({ available: false }));
    render(<ClaudeSettings />);
    await screen.findByText("Unavailable");
    const link = screen.getByRole("link", { name: /Setup guide/ });
    expect(link).toHaveAttribute("href", CLAUDE_GUIDE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noreferrer|noopener/);
  });

  it("renders as a Card with a Claude heading", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    render(<ClaudeSettings />);
    expect(await screen.findByRole("heading", { name: "Claude" })).toBeInTheDocument();
  });
});

describe("SecretInput", () => {
  it("defaults to a password input with autocomplete off and a Show value toggle", () => {
    render(<SecretInput aria-label="Token" defaultValue="sk-secret" />);
    const input = screen.getByLabelText("Token");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    const toggle = screen.getByRole("button", { name: "Show value" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("type", "button");
  });

  it("toggles to plain text and back without losing the value", () => {
    render(<SecretInput aria-label="Token" defaultValue="sk-secret" />);
    const input = screen.getByLabelText("Token") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Show value" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input.value).toBe("sk-secret");
    const hide = screen.getByRole("button", { name: "Hide value" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hide);
    expect(input).toHaveAttribute("type", "password");
    expect(input.value).toBe("sk-secret");
  });

  it("the toggle does not submit an enclosing form", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><SecretInput aria-label="Token" /></form>);
    fireEvent.click(screen.getByRole("button", { name: "Show value" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("forwards ref, id, placeholder, disabled and onChange to the input", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<SecretInput ref={ref} id="k" aria-label="Key" placeholder="Configured" disabled onChange={onChange} value="" />);
    const input = screen.getByLabelText("Key");
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute("id", "k");
    expect(input).toHaveAttribute("placeholder", "Configured");
    expect(input).toBeDisabled();
  });

  it("calls onChange when typing", () => {
    const onChange = vi.fn();
    render(<SecretInput aria-label="Key" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("the toggle is a ghost icon button", () => {
    render(<SecretInput aria-label="Key" />);
    const toggle = screen.getByRole("button", { name: "Show value" });
    expect(toggle.className).toMatch(/h-9 w-9/);
    expect(toggle.className).not.toMatch(/bg-primary\b|border-border/);
  });
});
