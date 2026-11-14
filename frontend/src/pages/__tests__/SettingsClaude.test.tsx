import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClaudeSettings } from "@/components/settings/ClaudeSettings";

const claudeMock = vi.hoisted(() => ({ getClaudeStatus: vi.fn() }));
vi.mock("@/lib/claudeChat", () => ({ getClaudeStatus: claudeMock.getClaudeStatus }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const status = (over = {}) => ({
  available: true, sdk_version: "1.0", auth: "api_key", model: null, error: null, ...over,
});

describe("ClaudeSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows Connected when using an API key", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    render(<ClaudeSettings />);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Using API key")).toBeInTheDocument();
  });

  it("shows Connected when using the Claude login", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status({ auth: "claude_login" }));
    render(<ClaudeSettings />);
    expect(await screen.findByText("Using your Claude login")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows Needs login when auth is unknown", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status({ auth: "unknown" }));
    render(<ClaudeSettings />);
    expect(await screen.findByText("Needs login")).toBeInTheDocument();
    expect(screen.getByText("Set ANTHROPIC_API_KEY or log in with the claude command")).toBeInTheDocument();
  });

  it("shows Unavailable when the SDK is missing", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status({ available: false, auth: "unknown" }));
    render(<ClaudeSettings />);
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
  });

  it("copies the MCP command and links to the guide", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ClaudeSettings />);
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("claude mcp add vibe-crypto -- vibe-crypto-mcp"));
    expect(toastMock.success).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Setup guide/ })).toHaveAttribute(
      "href",
      "https://github.com/buckleson/vibe-trading-crypto/blob/main/docs/vibe-crypto/CLAUDE_CODE.md",
    );
  });

  it("dispatches the open-dock event", async () => {
    claudeMock.getClaudeStatus.mockResolvedValue(status());
    const listener = vi.fn();
    window.addEventListener("vc:open-dock", listener);
    render(<ClaudeSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Open chat" }));
    expect(listener).toHaveBeenCalled();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: "chat" });
    window.removeEventListener("vc:open-dock", listener);
  });
});
