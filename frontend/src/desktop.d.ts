export {};

export interface DesktopCredentialStatus {
  available: boolean;
  configured: string[];
  migrated: string[];
}

export interface DesktopTerminalApi {
  start: (cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => Promise<void>;
  onData: (cb: (data: string) => void) => () => void;
  onExit: (cb: (info: { exitCode: number }) => void) => () => void;
}

declare global {
  interface Window {
    vibeDesktop?: {
      isDesktop: boolean;
      terminal?: DesktopTerminalApi;
      restartBackend: () => Promise<boolean>;
      getCredentialStatus: () => Promise<DesktopCredentialStatus>;
      setCredential: (
        name: string,
        value: string | null,
      ) => Promise<DesktopCredentialStatus>;
    };
  }
}
