import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  safeStorage,
  shell,
} from "electron";
import fs from "fs";
import path from "path";
import { registerAppScheme, serveApp } from "./appProtocol";
import { APP_ORIGIN, isAppUrl } from "./appRoutes";
import { DesktopConfig, loadConfig } from "./config";
import { initDatabase, TenantDatabaseManager } from "./database/sqlite";
import { registerIpcHandlers } from "./ipc/handlers";
import { SyncIdentity } from "./sync/contract";
import { SyncEngine } from "./sync/engine";
import { MfaTrustJar, MfaTrustStore } from "./security/mfaTrust";
import { identityFromToken, sameIdentity, validateTokenWithServer } from "./security/token";
import { startUpdates, Updates } from "./updater";

let mainWindow: BrowserWindow | null = null;
let dbManager: TenantDatabaseManager | null = null;
let syncEngine: SyncEngine | null = null;
let updates: Updates | null = null;
let sessionGeneration = 0;
let toldToUpdate = false;

const isDev = !app.isPackaged;
const DEV_ORIGIN = "http://localhost:8448";
// Packaged: electron-builder copies the web bundle to resources/web
// (extraResources). In development it is the web package's own build.
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.resolve(__dirname, "../../web/dist");

// Before ready: the packaged app runs at app://oraiza (see appProtocol.ts).
registerAppScheme();

interface StoredSession {
  version: 1;
  token: string;
  identity: SyncIdentity;
  validatedAt: string;
}

const sessionFile = (): string => path.join(app.getPath("userData"), "sync-session.bin");
const legacyTokenFile = (): string => path.join(app.getPath("userData"), "sync-token.bin");

function secureCredentialStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // Electron's Linux `basic_text` backend is only obfuscation. Treat it as no
  // encryption and keep the credential in memory for this process instead.
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

function clearStoredSession(): void {
  try {
    fs.rmSync(sessionFile(), { force: true });
    // Raw-token files from releases before the validated session envelope are
    // intentionally not trusted or migrated.
    fs.rmSync(legacyTokenFile(), { force: true });
  } catch {
    console.error("[main] failed to clear the encrypted sync session");
  }
}

function persistSession(value: StoredSession | null): void {
  if (!value) {
    clearStoredSession();
    return;
  }
  try {
    fs.rmSync(legacyTokenFile(), { force: true });
    if (!secureCredentialStorageAvailable()) return; // memory-only fallback
    fs.writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(value)), {
      mode: 0o600,
    });
  } catch {
    // Do not print an exception object: filesystem errors can contain user paths.
    console.error("[main] failed to persist the encrypted sync session");
  }
}

function loadStoredSession(): StoredSession | null {
  try {
    fs.rmSync(legacyTokenFile(), { force: true });
    if (!secureCredentialStorageAvailable() || !fs.existsSync(sessionFile())) return null;
    const parsed: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile())));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("invalid envelope");
    const value = parsed as Partial<StoredSession>;
    if (
      value.version !== 1 ||
      typeof value.token !== "string" ||
      typeof value.validatedAt !== "string" ||
      Number.isNaN(Date.parse(value.validatedAt)) ||
      typeof value.identity !== "object" ||
      value.identity === null
    ) {
      throw new Error("invalid envelope");
    }
    const claimsIdentity = identityFromToken(value.token);
    if (!sameIdentity(claimsIdentity, value.identity as SyncIdentity))
      throw new Error("identity mismatch");
    return value as StoredSession;
  } catch {
    clearStoredSession();
    return null;
  }
}

const mfaTrustFile = (): string => path.join(app.getPath("userData"), "mfa-trust.bin");

/** The weekly 2FA trust, encrypted at rest like the sync session; in memory
 *  only where the OS offers no real encryption. */
const mfaTrustStore: MfaTrustStore = {
  load() {
    try {
      if (!secureCredentialStorageAvailable() || !fs.existsSync(mfaTrustFile())) return [];
      const parsed: unknown = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(mfaTrustFile())),
      );
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
    } catch {
      return [];
    }
  },
  save(tokens) {
    try {
      if (!secureCredentialStorageAvailable()) return; // memory-only fallback
      fs.writeFileSync(mfaTrustFile(), safeStorage.encryptString(JSON.stringify(tokens)), {
        mode: 0o600,
      });
    } catch {
      // Do not print an exception object: filesystem errors can contain user paths.
      console.error("[main] failed to persist the 2FA trust");
    }
  },
};

function isAllowedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return false;
    // The app's own origin only. app://oraiza serves nothing but the web bundle
    // (and its SPA routes), so any path on it is the app; a list of routes here
    // went stale as pages were added, and locked those pages out of IPC.
    return isDev ? parsed.origin === DEV_ORIGIN : isAppUrl(parsed);
  } catch {
    return false;
  }
}

function authorizeIpc(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isAllowedAppUrl(event.senderFrame.url)
  ) {
    throw new Error("IPC request denied");
  }
}

/** Once per run: the server won't serve this build any more. */
function tellToUpdate(): void {
  if (toldToUpdate) return;
  toldToUpdate = true;
  updates?.checkNow();
  void dialog.showMessageBox({
    type: "warning",
    title: "Update needed",
    message: "This version of Oraiza is too old to sync.",
    detail: updates?.enabled
      ? "The update is downloading. You'll be asked to restart when it's ready."
      : "Install the latest version to keep working. Ask your mill's owner for the installer.",
  });
}

function createWindow(config: DesktopConfig): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      // The renderer opens the warehouse WebSocket to the API itself (a
      // protocol handler can't carry one); the preload hands it the origin.
      additionalArguments: [`--oraiza-api-origin=${config.apiOrigin}`],
    },
    titleBarStyle: "hiddenInset",
    title: "Rice Mill System",
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_ORIGIN);
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/`);
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Apply navigation, child-window, webview, and permission restrictions to every
// WebContents the application creates, including future accidental additions.
app.on("web-contents-created", (_event, contents) => {
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setDevicePermissionHandler(() => false);

  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // Malformed destinations are denied below.
    }
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());

  const guardNavigation = (event: Electron.Event, url: string): void => {
    if (!isAllowedAppUrl(url)) event.preventDefault();
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
});

function clearActiveSession(): void {
  sessionGeneration += 1;
  syncEngine?.clearSession();
  persistSession(null);
}

app.whenReady().then(() => {
  if (!isDev) Menu.setApplicationMenu(null);

  let config: DesktopConfig;
  try {
    config = loadConfig({ packaged: app.isPackaged, dir: __dirname });
  } catch (error) {
    dialog.showErrorBox(
      "Oraiza can't start",
      `This build is misconfigured: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
    app.quit();
    return;
  }
  const apiBase = `${config.apiOrigin}/api`;
  const appVersion = app.getVersion();
  updates = startUpdates(config.updates);
  if (!isDev) {
    serveApp({
      webRoot: WEB_ROOT,
      apiOrigin: config.apiOrigin,
      appVersion,
      onUpgradeRequired: tellToUpdate,
      mfaTrust: new MfaTrustJar(mfaTrustStore),
    });
  }

  dbManager = initDatabase();
  syncEngine = new SyncEngine(dbManager, {
    apiBase,
    appVersion,
    onSessionInvalidated: () => persistSession(null),
    onUpgradeRequired: tellToUpdate,
  });
  registerIpcHandlers(dbManager, authorizeIpc);

  // The encrypted envelope was server-validated when stored. Its still-live JWT
  // claims bind the local DB partition immediately for offline startup; the next
  // API request revalidates signature/revocation server-side.
  const restored = loadStoredSession();
  if (restored) syncEngine.setSession(restored.token, restored.identity);

  ipcMain.handle("sync:setToken", async (event, token: unknown) => {
    authorizeIpc(event);
    if (typeof token !== "string") throw new Error("Invalid sync credential");
    if (!token) {
      clearActiveSession();
      return { ok: true };
    }

    const generation = ++sessionGeneration;
    try {
      // `/auth/me` verifies the JWT signature, expiry/revocation, database user,
      // tenant identity, and offline_sync subscription before local activation.
      const identity = await validateTokenWithServer(token, apiBase, appVersion);
      if (generation !== sessionGeneration) return { ok: false, superseded: true };
      syncEngine?.setSession(token, identity);
      persistSession({ version: 1, token, identity, validatedAt: new Date().toISOString() });
      void syncEngine?.sync();
      return { ok: true };
    } catch {
      if (generation === sessionGeneration) clearActiveSession();
      throw new Error("Unable to establish the desktop sync session");
    }
  });

  ipcMain.handle("sync:clearToken", (event) => {
    authorizeIpc(event);
    clearActiveSession();
    return { ok: true };
  });

  createWindow(config);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on("window-all-closed", () => {
  syncEngine?.stop();
  if (process.platform !== "darwin") app.quit();
});
