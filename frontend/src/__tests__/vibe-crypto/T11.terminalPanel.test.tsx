// T11 test-engineer suite for the embedded Claude terminal panel.
// xterm and the fit addon are mocked; window.vibeDesktop.terminal is a fake.
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeTerm = {
  ctorOptions: Record<string, unknown>;
  options: Record<string, unknown>;
  cols: number;
  rows: number;
  write: ReturnType<typeof vi.fn>;
  writeln: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  inputDispose: ReturnType<typeof vi.fn>;
  emitInput: (d: string) => void;
};
const terms: FakeTerm[] = [];
const fits: Array<{ fit: ReturnType<typeof vi.fn> }> = [];
const fitBehaviour = { throwOnFit: false };

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 132;
    rows = 41;
    options: Record<string, unknown>;
    ctorOptions: Record<string, unknown>;
    write = vi.fn();
    writeln = vi.fn();
    clear = vi.fn();
    dispose = vi.fn();
    open = vi.fn();
    loadAddon = vi.fn();
    inputDispose = vi.fn();
    private handler: ((d: string) => void) | undefined;
    constructor(opts: Record<string, unknown>) {
      this.ctorOptions = opts;
      this.options = { ...opts };
      terms.push(this as unknown as FakeTerm);
    }
    onData(cb: (d: string) => void) {
      this.handler = cb;
      return { dispose: this.inputDispose };
    }
    emitInput(d: string) {
      this.handler?.(d);
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn(() => {
      if (fitBehaviour.throwOnFit) throw new Error("not laid out");
    });
    constructor() {
      fits.push(this as never);
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { TerminalPanel, terminalAvailable } from "@/components/terminal/TerminalPanel";

let resizeCallbacks: Array<() => void> = [];
let resizeDisconnects = 0;

function fakeApi() {
  const dataCbs: Array<(d: string) => void> = [];
  const exitCbs: Array<(i: { exitCode: number }) => void> = [];
  const offData = vi.fn();
  const offExit = vi.fn();
  const api = {
    start: vi.fn().mockResolvedValue({ ok: true }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn((cb: (d: string) => void) => {
      dataCbs.push(cb);
      return offData;
    }),
    onExit: vi.fn((cb: (i: { exitCode: number }) => void) => {
      exitCbs.push(cb);
      return offExit;
    }),
  };
  return {
    api,
    offData,
    offExit,
    emitData: (d: string) => dataCbs.forEach((cb) => cb(d)),
    emitExit: (code = 0) => exitCbs.forEach((cb) => cb({ exitCode: code })),
  };
}

function install(f = fakeApi()) {
  window.vibeDesktop = { isDesktop: true, terminal: f.api } as never;
  return f;
}

describe("T11 TerminalPanel", () => {
  beforeEach(() => {
    terms.length = 0;
    fits.length = 0;
    fitBehaviour.throwOnFit = false;
    resizeCallbacks = [];
    resizeDisconnects = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resizeCallbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          resizeDisconnects += 1;
        }
      },
    );
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.vibeDesktop;
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });

  describe("terminalAvailable", () => {
    it("is false in a plain browser", () => {
      expect(terminalAvailable()).toBe(false);
    });
    it("is false on a desktop bridge without the terminal API", () => {
      window.vibeDesktop = { isDesktop: true } as never;
      expect(terminalAvailable()).toBe(false);
    });
    it("is false when terminal is explicitly undefined", () => {
      window.vibeDesktop = { isDesktop: true, terminal: undefined } as never;
      expect(terminalAvailable()).toBe(false);
    });
    it("is true when the desktop terminal API exists", () => {
      install();
      expect(terminalAvailable()).toBe(true);
    });
  });

  describe("without the desktop terminal", () => {
    it("renders an empty state and creates no xterm instance", () => {
      render(<TerminalPanel />);
      expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
      expect(terms).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
    });
  });

  describe("in the desktop app", () => {
    it("renders the header copy and a Restart button", () => {
      install();
      render(<TerminalPanel />);
      expect(screen.getByText("Claude Code with Vibe Crypto tools")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Restart" })).toBeInTheDocument();
    });

    it("creates exactly one xterm with the specified options and opens it in the panel", () => {
      install();
      render(<TerminalPanel />);
      expect(terms).toHaveLength(1);
      const t = terms[0];
      expect(t.ctorOptions).toMatchObject({
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 13,
        cursorBlink: true,
        allowProposedApi: false,
      });
      expect(t.loadAddon).toHaveBeenCalledWith(fits[0]);
      expect(t.open).toHaveBeenCalledTimes(1);
      expect(t.open.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
      expect(fits[0].fit).toHaveBeenCalled();
    });

    it("starts the PTY once with the fitted size", () => {
      const f = install();
      render(<TerminalPanel />);
      expect(f.api.start).toHaveBeenCalledTimes(1);
      expect(f.api.start).toHaveBeenCalledWith(132, 41);
    });

    it("still starts when the first fit throws (hidden dock tab)", () => {
      fitBehaviour.throwOnFit = true;
      const f = install();
      expect(() => render(<TerminalPanel />)).not.toThrow();
      expect(f.api.start).toHaveBeenCalledWith(132, 41);
    });

    it("forwards keyboard input to the PTY verbatim, including control bytes and empty strings", () => {
      const f = install();
      render(<TerminalPanel />);
      for (const input of ["a", "\r", "\x03", "\x1b[A", "", "ünïcødé 🚀"]) terms[0].emitInput(input);
      expect(f.api.write.mock.calls.map((c) => c[0])).toEqual(["a", "\r", "\x03", "\x1b[A", "", "ünïcødé 🚀"]);
    });

    it("writes PTY output to the terminal in order", () => {
      const f = install();
      render(<TerminalPanel />);
      act(() => {
        f.emitData("\x1b[32mgreen\x1b[0m");
        f.emitData("line2\r\n");
      });
      expect(terms[0].write.mock.calls.map((c) => c[0])).toEqual(["\x1b[32mgreen\x1b[0m", "line2\r\n"]);
    });

    it("prints the exit notice on PTY exit for any exit code", () => {
      const f = install();
      render(<TerminalPanel />);
      act(() => f.emitExit(0));
      act(() => f.emitExit(137));
      expect(terms[0].writeln).toHaveBeenCalledTimes(2);
      expect(terms[0].writeln).toHaveBeenCalledWith("\r\n[Claude exited. Press Restart to start again.]");
    });

    it("refits and resizes the PTY when the container resizes", () => {
      const f = install();
      render(<TerminalPanel />);
      expect(resizeCallbacks).toHaveLength(1);
      fits[0].fit.mockClear();
      act(() => resizeCallbacks[0]());
      expect(fits[0].fit).toHaveBeenCalledTimes(1);
      expect(f.api.resize).toHaveBeenCalledWith(132, 41);
    });

    it("does not resize the PTY when fit fails during a resize", () => {
      const f = install();
      render(<TerminalPanel />);
      fitBehaviour.throwOnFit = true;
      expect(() => act(() => resizeCallbacks[0]())).not.toThrow();
      expect(f.api.resize).not.toHaveBeenCalled();
    });

    it("Restart kills first, clears the screen, then starts with the current size", async () => {
      const f = install();
      render(<TerminalPanel />);
      f.api.start.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Restart" }));
      await waitFor(() => expect(f.api.start).toHaveBeenCalledTimes(1));
      expect(f.api.kill).toHaveBeenCalledTimes(1);
      expect(f.api.kill.mock.invocationCallOrder[0]).toBeLessThan(f.api.start.mock.invocationCallOrder[0]);
      expect(terms[0].clear).toHaveBeenCalled();
      expect(f.api.start).toHaveBeenCalledWith(132, 41);
      expect(terms).toHaveLength(1);
    });

    it("Restart waits for kill to resolve before starting", async () => {
      const f = install();
      let releaseKill: () => void = () => {};
      f.api.kill.mockImplementation(() => new Promise<void>((r) => { releaseKill = r; }));
      render(<TerminalPanel />);
      f.api.start.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Restart" }));
      await Promise.resolve();
      expect(f.api.start).not.toHaveBeenCalled();
      await act(async () => releaseKill());
      await waitFor(() => expect(f.api.start).toHaveBeenCalledTimes(1));
    });

    it("unmount unsubscribes, disconnects observers and disposes xterm without killing the PTY", () => {
      const f = install();
      const { unmount } = render(<TerminalPanel />);
      unmount();
      expect(f.offData).toHaveBeenCalledTimes(1);
      expect(f.offExit).toHaveBeenCalledTimes(1);
      expect(terms[0].inputDispose).toHaveBeenCalledTimes(1);
      expect(terms[0].dispose).toHaveBeenCalledTimes(1);
      expect(resizeDisconnects).toBe(1);
      expect(f.api.kill).not.toHaveBeenCalled();
    });

    it("remount reattaches and starts again (main process treats a running PTY as ok)", () => {
      const f = install();
      const first = render(<TerminalPanel />);
      first.unmount();
      render(<TerminalPanel />);
      expect(terms).toHaveLength(2);
      expect(f.api.start).toHaveBeenCalledTimes(2);
      expect(f.api.onData).toHaveBeenCalledTimes(2);
      expect(f.api.kill).not.toHaveBeenCalled();
    });
  });

  describe("theming", () => {
    it("derives hex colours from CSS tokens, with selection at 30% alpha", () => {
      const root = document.documentElement;
      root.style.setProperty("--card", "0 0% 100%");
      root.style.setProperty("--foreground", "0 100% 50%");
      root.style.setProperty("--primary", "240 100% 50%");
      install();
      render(<TerminalPanel />);
      expect(terms[0].ctorOptions.theme).toEqual({
        background: "#ffffff",
        foreground: "#ff0000",
        cursor: "#0000ff",
        selectionBackground: "#0000ff4d",
      });
    });

    it("falls back to valid hex colours when tokens are missing", () => {
      install();
      render(<TerminalPanel />);
      const theme = terms[0].ctorOptions.theme as Record<string, string>;
      expect(theme.background).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.foreground).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.cursor).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.selectionBackground).toMatch(/^#[0-9a-f]{8}$/);
      expect(theme.selectionBackground.endsWith("4d")).toBe(true);
    });

    it("re-themes when the dark class toggles on <html>", async () => {
      const root = document.documentElement;
      root.style.setProperty("--card", "0 0% 100%");
      install();
      render(<TerminalPanel />);
      expect((terms[0].options.theme as Record<string, string>).background).toBe("#ffffff");
      root.style.setProperty("--card", "0 0% 0%");
      root.classList.add("dark");
      await waitFor(() =>
        expect((terms[0].options.theme as Record<string, string>).background).toBe("#000000"),
      );
    });

    it("stops re-theming after unmount", async () => {
      const root = document.documentElement;
      root.style.setProperty("--card", "0 0% 100%");
      install();
      const { unmount } = render(<TerminalPanel />);
      unmount();
      root.style.setProperty("--card", "0 0% 0%");
      root.classList.add("dark");
      await new Promise((r) => setTimeout(r, 20));
      expect((terms[0].options.theme as Record<string, string>).background).toBe("#ffffff");
    });
  });

  describe("source hygiene", () => {
    const srcPath = path.resolve(__dirname, "../../components/terminal/TerminalPanel.tsx");
    const source = readFileSync(srcPath, "utf8");

    it("imports the xterm stylesheet", () => {
      expect(source).toContain('import "@xterm/xterm/css/xterm.css"');
    });

    it("never kills the PTY on unmount (only Restart calls kill)", () => {
      expect(source.match(/\.kill\(/g) ?? []).toHaveLength(1);
    });

    it("has no slop patterns in UI copy", () => {
      expect(source).not.toMatch(/—/);
      expect(source).not.toMatch(/uppercase/);
      expect(source).not.toMatch(/gradient/i);
      expect(source).not.toMatch(/purple|violet|beige/i);
    });

    it("pins the two xterm packages in package.json", () => {
      const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      expect(deps["@xterm/xterm"]).toMatch(/^\^5\.5\./);
      expect(deps["@xterm/addon-fit"]).toMatch(/^\^0\.10\./);
    });
  });
});
