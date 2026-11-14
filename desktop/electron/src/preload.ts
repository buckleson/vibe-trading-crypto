import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vibeDesktop", {
  isDesktop: true,
  onStatus: (callback: (message: string) => void) => {
    ipcRenderer.on("desktop:status", (_event, message: string) => callback(message));
  },
  onError: (callback: (message: string) => void) => {
    ipcRenderer.on("desktop:error", (_event, message: string) => callback(message));
  },
  retry: () => ipcRenderer.send("desktop:retry"),
  openLogs: () => ipcRenderer.send("desktop:open-logs"),
  restartBackend: () => ipcRenderer.invoke("desktop:restart-backend") as Promise<boolean>,
  getCredentialStatus: () => ipcRenderer.invoke("desktop:get-credential-status"),
  setCredential: (name: string, value: string | null) =>
    ipcRenderer.invoke("desktop:set-credential", name, value),
  terminal: {
    start: (cols: number, rows: number) =>
      ipcRenderer.invoke("terminal:start", cols, rows) as Promise<{ ok: boolean; error?: string }>,
    write: (data: string) => ipcRenderer.send("terminal:write", data),
    resize: (cols: number, rows: number) => ipcRenderer.send("terminal:resize", cols, rows),
    kill: () => ipcRenderer.invoke("terminal:kill") as Promise<void>,
    onData: (callback: (data: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: string): void => callback(data);
      ipcRenderer.on("terminal:data", listener);
      return () => { ipcRenderer.removeListener("terminal:data", listener); };
    },
    onExit: (callback: (info: { exitCode: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: { exitCode: number }): void => callback(info);
      ipcRenderer.on("terminal:exit", listener);
      return () => { ipcRenderer.removeListener("terminal:exit", listener); };
    },
  },
});
