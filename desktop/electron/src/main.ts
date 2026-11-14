import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from "electron";
import { BackendManager, resolveBackend, resolveMcpCommand } from "./backend-manager";
import { buildMcpConfig, ClaudeTerminal } from "./terminal-manager";
import {
  DesktopLocale,
  getDesktopMessages,
  getRendererLocale,
  resolveDesktopLocale,
} from "./locales";
import { SecureCredentialStore } from "./secure-credentials";

let mainWindow: BrowserWindow | undefined;
let backend: BackendManager | undefined;
let bootPromise: Promise<void> | undefined;
let quitting = false;
let desktopLocale: DesktopLocale = "en";
let desktopMessages = getDesktopMessages(desktopLocale);
const productName = "Vibe Crypto";
const testUserData = process.env.VIBE_TRADING_DESKTOP_TEST_USER_DATA;
let credentialStore: SecureCredentialStore | undefined;
const claudeTerminal = new ClaudeTerminal();

if (testUserData) app.setPath("userData", path.resolve(testUserData));
app.setName(productName);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  void app.whenReady().then(ready).catch((error) => {
    dialog.showErrorBox(desktopMessages.startupFailureTitle, errorText(error));
  });
}

async function ready(): Promise<void> {
  desktopLocale = resolveDesktopLocale(
    process.env.VIBE_TRADING_DESKTOP_LOCALE ?? app.getLocale(),
  );
  desktopMessages = getDesktopMessages(desktopLocale);
  nativeTheme.themeSource = "dark";
  app.setAppLogsPath();
  credentialStore = new SecureCredentialStore({ messages: desktopMessages });
  await credentialStore.initialize();
  createWindow();
  registerIpc();
  createMenu();
  await showLoadingPage();
  void boot();
}

function createWindow(): void {
  const parentDeathSmoke = Boolean(process.env.VIBE_TRADING_DESKTOP_PARENT_DEATH_SMOKE_FILE);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0E1016",
    title: productName,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      partition: "persist:vibe-crypto",
    },
  });
  const rendererSession = mainWindow.webContents.session;
  rendererSession.setPermissionCheckHandler(() => false);
  rendererSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (!parentDeathSmoke) {
    mainWindow.once("ready-to-show", () => mainWindow?.show());
  }
  mainWindow.on("close", (event) => {
    claudeTerminal.kill();
    if (quitting) return;
    event.preventDefault();
    void shutdownAndQuit();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentOrigin = backend?.url ? new URL(backend.url).origin : undefined;
    if (currentOrigin && safeOrigin(url) === currentOrigin) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
}

function registerIpc(): void {
  registerTerminalIpc();
  ipcMain.on("desktop:retry", (event) => {
    assertMainWindowSender(event.sender);
    void boot();
  });
  ipcMain.on("desktop:open-logs", (event) => {
    assertMainWindowSender(event.sender);
    void shell.openPath(app.getPath("logs"));
  });
  ipcMain.handle("desktop:restart-backend", async (event) => {
    assertMainWindowSender(event.sender);
    await boot();
    return true;
  });
  ipcMain.handle("desktop:get-credential-status", (event) => {
    assertMainWindowSender(event.sender);
    return requireCredentialStore().status();
  });
  ipcMain.handle("desktop:set-credential", async (event, name: unknown, value: unknown) => {
    assertMainWindowSender(event.sender);
    if (typeof name !== "string" || (typeof value !== "string" && value !== null)) {
      throw new Error(desktopMessages.credentialRequestInvalid);
    }
    const store = requireCredentialStore();
    await store.set(name, value);
    return store.status();
  });
}

function terminalMcpConfigPath(): string | undefined {
  try {
    const found = resolveBackend({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      moduleDirectory: __dirname,
      allowSourceDiscovery: !app.isPackaged,
      executableOverride: process.env.VIBE_TRADING_EXECUTABLE,
      pathEnvironment: process.env.PATH,
    });
    const config = buildMcpConfig(found ? resolveMcpCommand(found) : undefined);
    if (!config) return undefined;
    const target = path.join(app.getPath("userData"), "claude-mcp.json");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(config, null, 2), "utf8");
    return target;
  } catch {
    return undefined;
  }
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1000;
}

function registerTerminalIpc(): void {
  ipcMain.handle("terminal:start", (event, cols: unknown, rows: unknown) => {
    assertMainWindowSender(event.sender);
    if (!isDimension(cols) || !isDimension(rows)) throw new Error("Invalid terminal size");
    const mcpConfigPath = terminalMcpConfigPath();
    return claudeTerminal.start({
      cols,
      rows,
      mcpConfigPath,
      cwd: os.homedir(),
      env: process.env,
      onData: (chunk) => {
        if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("terminal:data", chunk);
      },
      onExit: (exitCode) => {
        if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("terminal:exit", { exitCode });
      },
    });
  });
  ipcMain.on("terminal:write", (event, data: unknown) => {
    assertMainWindowSender(event.sender);
    if (typeof data !== "string" || data.length > 65_536) return;
    claudeTerminal.write(data);
  });
  ipcMain.on("terminal:resize", (event, cols: unknown, rows: unknown) => {
    assertMainWindowSender(event.sender);
    if (!isDimension(cols) || !isDimension(rows)) return;
    claudeTerminal.resize(cols, rows);
  });
  ipcMain.handle("terminal:kill", (event) => {
    assertMainWindowSender(event.sender);
    claudeTerminal.kill();
  });
}

async function showLoadingPage(): Promise<void> {
  if (!mainWindow) return;
  const localePayload = Buffer.from(
    JSON.stringify(getRendererLocale(desktopLocale)),
    "utf8",
  ).toString("base64url");
  await mainWindow.loadFile(path.join(__dirname, "loading.html"), {
    query: { locale: localePayload },
  });
}

function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = bootInternal().finally(() => { bootPromise = undefined; });
  return bootPromise;
}

async function bootInternal(): Promise<void> {
  if (!mainWindow) return;
  await backend?.stop();
  if (!mainWindow.webContents.getURL().startsWith("file:")) await showLoadingPage();

  backend = new BackendManager({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    allowSourceDiscovery: !app.isPackaged,
    logDirectory: app.getPath("logs"),
    messages: desktopMessages,
    credentialEnvironment: requireCredentialStore().environment(),
    onStatus: (message) => mainWindow?.webContents.send("desktop:status", message),
    onUnexpectedExit: (message) => {
      if (!quitting) void reportBootError(message);
    },
  });

  try {
    const url = await backend.start();
    await mainWindow.loadURL(url);
    writeParentDeathSmokeRecord(url);
  } catch (error) {
    await backend.stop();
    const missing = errorText(error) === desktopMessages.backendNotFound;
    await reportBootError(
      missing && process.platform !== "win32" ? desktopMessages.backendMissingPosix : errorText(error),
    );
  }
}

function writeParentDeathSmokeRecord(url: string): void {
  const target = process.env.VIBE_TRADING_DESKTOP_PARENT_DEATH_SMOKE_FILE;
  if (!target) return;
  const backendPid = backend?.processId;
  if (!backendPid) throw new Error("Parent-death smoke test could not resolve the backend PID");
  writeFileSync(path.resolve(target), JSON.stringify({
    mainPid: process.pid,
    backendPid,
    backendOrigin: new URL(url).origin,
  }), { encoding: "utf8", flag: "wx" });
}

async function reportBootError(message: string): Promise<void> {
  if (!mainWindow) return;
  if (!mainWindow.webContents.getURL().startsWith("file:")) await showLoadingPage();
  mainWindow.webContents.send("desktop:error", message);
}

function createMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: desktopMessages.menuApplication,
      submenu: [
        { label: desktopMessages.menuRestartService, click: () => void boot() },
        { label: desktopMessages.menuOpenLogs, click: () => void shell.openPath(app.getPath("logs")) },
        { type: "separator" },
        { role: "quit", label: desktopMessages.menuQuit },
      ],
    },
    {
      label: desktopMessages.menuView,
      submenu: [
        { role: "reload", label: desktopMessages.menuReload },
        ...(!app.isPackaged
          ? [{ role: "toggleDevTools" as const, label: desktopMessages.menuDeveloperTools }]
          : []),
        { type: "separator" },
        { role: "resetZoom", label: desktopMessages.menuActualSize },
        { role: "zoomIn", label: desktopMessages.menuZoomIn },
        { role: "zoomOut", label: desktopMessages.menuZoomOut },
        { role: "togglefullscreen", label: desktopMessages.menuFullscreen },
      ],
    },
  ]));
}

function assertMainWindowSender(sender: Electron.WebContents): void {
  if (sender !== mainWindow?.webContents) throw new Error("Desktop request rejected");
}

function requireCredentialStore(): SecureCredentialStore {
  if (!credentialStore) throw new Error(desktopMessages.credentialStoreUnavailable);
  return credentialStore;
}

async function shutdownAndQuit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  claudeTerminal.kill();
  mainWindow?.webContents.send("desktop:status", desktopMessages.closingService);
  await backend?.stop();
  app.quit();
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function safeOrigin(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") void shutdownAndQuit();
});

process.on("uncaughtException", (error) => {
  dialog.showErrorBox(productName, error.stack ?? error.message);
});
