import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const termInstances: Array<{
  cols: number; rows: number; write: ReturnType<typeof vi.fn>; writeln: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; emitInput: (d: string) => void;
}> = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 100; rows = 30; options: Record<string, unknown> = {};
    write = vi.fn(); writeln = vi.fn(); clear = vi.fn(); dispose = vi.fn();
    loadAddon = vi.fn(); open = vi.fn();
    private handler: ((d: string) => void) | undefined;
    onData(cb: (d: string) => void) { this.handler = cb; return { dispose: vi.fn() }; }
    emitInput(d: string) { this.handler?.(d); }
    constructor() { termInstances.push(this as never); }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { TerminalPanel, terminalAvailable } from "../TerminalPanel";

function fakeApi() {
  let dataCb: (d: string) => void = () => {};
  let exitCb: (i: { exitCode: number }) => void = () => {};
  const offData = vi.fn(); const offExit = vi.fn();
  const api = {
    start: vi.fn().mockResolvedValue({ ok: true }),
    write: vi.fn(), resize: vi.fn(),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn((cb: (d: string) => void) => { dataCb = cb; return offData; }),
    onExit: vi.fn((cb: (i: { exitCode: number }) => void) => { exitCb = cb; return offExit; }),
  };
  return { api, offData, offExit, emitData: (d: string) => dataCb(d), emitExit: () => exitCb({ exitCode: 0 }) };
}

describe("TerminalPanel", () => {
  beforeEach(() => {
    termInstances.length = 0;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.vibeDesktop;
  });

  it("terminalAvailable reflects the desktop terminal API", () => {
    expect(terminalAvailable()).toBe(false);
    window.vibeDesktop = { isDesktop: true } as never;
    expect(terminalAvailable()).toBe(false);
    window.vibeDesktop = { isDesktop: true, terminal: fakeApi().api } as never;
    expect(terminalAvailable()).toBe(true);
  });

  it("starts with the terminal size and wires input and output", () => {
    const f = fakeApi();
    window.vibeDesktop = { isDesktop: true, terminal: f.api } as never;
    render(<TerminalPanel />);
    expect(f.api.start).toHaveBeenCalledWith(100, 30);
    termInstances[0].emitInput("ls\r");
    expect(f.api.write).toHaveBeenCalledWith("ls\r");
    act(() => f.emitData("hello"));
    expect(termInstances[0].write).toHaveBeenCalledWith("hello");
    act(() => f.emitExit());
    expect(termInstances[0].writeln).toHaveBeenCalledWith(expect.stringContaining("Restart"));
  });

  it("Restart kills then starts", async () => {
    const f = fakeApi();
    window.vibeDesktop = { isDesktop: true, terminal: f.api } as never;
    render(<TerminalPanel />);
    f.api.start.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(f.api.start).toHaveBeenCalledTimes(1));
    expect(f.api.kill).toHaveBeenCalledTimes(1);
    expect(f.api.kill.mock.invocationCallOrder[0]).toBeLessThan(f.api.start.mock.invocationCallOrder[0]);
  });

  it("unmount unsubscribes without killing the PTY", () => {
    const f = fakeApi();
    window.vibeDesktop = { isDesktop: true, terminal: f.api } as never;
    const { unmount } = render(<TerminalPanel />);
    unmount();
    expect(f.offData).toHaveBeenCalled();
    expect(f.offExit).toHaveBeenCalled();
    expect(termInstances[0].dispose).toHaveBeenCalled();
    expect(f.api.kill).not.toHaveBeenCalled();
  });
});
