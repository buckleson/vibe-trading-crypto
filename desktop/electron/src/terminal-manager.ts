import { existsSync, statSync } from "node:fs";
import path from "node:path";

type PtyProcess = {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

type PtyModule = {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ): PtyProcess;
};

export type TerminalStartOptions = {
  cols: number;
  rows: number;
  mcpConfigPath?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onData(data: string): void;
  onExit(code: number): void;
};

export function findExecutable(
  name: string,
  envPath: string,
  platform: NodeJS.Platform = process.platform,
  pathExt: string | undefined = process.env.PATHEXT,
): string | undefined {
  const extensions = platform === "win32"
    ? [".cmd", ".exe", ".bat", ...(pathExt ?? "").split(";").filter(Boolean).map((e) => e.toLowerCase())]
    : [""];
  const unique = [...new Set(extensions)];
  for (const rawEntry of envPath.split(platform === "win32" ? ";" : path.delimiter)) {
    const entry = rawEntry.replaceAll('"', "").trim();
    if (!entry) continue;
    for (const extension of unique) {
      const candidate = path.join(entry, name + extension);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function isFile(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function buildMcpConfig(
  mcp: { command: string; args: string[] } | undefined,
): object | undefined {
  if (!mcp) return undefined;
  return { mcpServers: { "vibe-crypto": { command: mcp.command, args: mcp.args } } };
}

const clamp = (value: number): number => Math.max(2, Math.min(500, Math.floor(value)));

export class ClaudeTerminal {
  private pty: PtyProcess | undefined;

  get running(): boolean {
    return this.pty !== undefined;
  }

  start(options: TerminalStartOptions): { ok: true } | { ok: false; error: string } {
    if (this.pty) return { ok: true };
    const claudePath = findExecutable("claude", options.env.PATH ?? process.env.PATH ?? "");
    if (!claudePath) {
      options.onData(
        "Claude Code CLI was not found on PATH.\r\n" +
          "Install it with: npm install -g @anthropic-ai/claude-code\r\n" +
          "Then press Restart.\r\n",
      );
      return { ok: false, error: "claude-not-found" };
    }

    let pty: PtyModule;
    try {
      // Lazy: a missing native build must not stop the app from starting.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pty = require("node-pty") as PtyModule;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      options.onData(`The terminal component (node-pty) could not be loaded.\r\n${detail}\r\n`);
      return { ok: false, error: `node-pty-unavailable: ${detail}` };
    }

    const args = options.mcpConfigPath ? ["--mcp-config", options.mcpConfigPath] : [];
    let file = claudePath;
    let spawnArgs = args;
    if (process.platform === "win32" && /\.(cmd|bat)$/iu.test(claudePath)) {
      file = process.env.ComSpec || "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", claudePath, ...args];
    }
    const env: NodeJS.ProcessEnv = { ...options.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
    delete env.ELECTRON_RUN_AS_NODE;

    try {
      const child = pty.spawn(file, spawnArgs, {
        name: "xterm-256color",
        cols: clamp(options.cols),
        rows: clamp(options.rows),
        cwd: options.cwd,
        env,
      });
      this.pty = child;
      child.onData((data) => options.onData(data));
      child.onExit(({ exitCode }) => {
        if (this.pty === child) this.pty = undefined;
        options.onExit(exitCode);
      });
      return { ok: true };
    } catch (error) {
      this.pty = undefined;
      const detail = error instanceof Error ? error.message : String(error);
      options.onData(`Could not start Claude Code: ${detail}\r\n`);
      return { ok: false, error: detail };
    }
  }

  write(data: string): void {
    this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.pty?.resize(clamp(cols), clamp(rows));
    } catch {
      // The PTY exited between the check and the resize.
    }
  }

  kill(): void {
    const child = this.pty;
    this.pty = undefined;
    try {
      child?.kill();
    } catch {
      // Already gone.
    }
  }
}
