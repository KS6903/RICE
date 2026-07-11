import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  safeStorage,
  shell,
} from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDatabase, TenantDatabaseManager } from "./database/sqlite";
import { registerIpcHandlers } from "./ipc/handlers";
import { SyncIdentity } from "./sync/contract";
import { SyncEngine } from "./sync/engine";
import { identityFromToken, sameIdentity, validateTokenWithServer } from "./security/token";

let mainWindow: BrowserWindow | null = null;
let dbManager: TenantDatabaseManager | null = null;
let syncEngine: SyncEngine | null = null;
let sessionGeneration = 0;

const isDev = !app.isPackaged;
const DEV_ORIGIN = "http://localhost:8448";
const API_BASE = "http://localhost:8000/api";
const WEB_ROOT = path.resolve(__dirname, "../../web/dist");
const APP_INDEX = path.join(WEB_ROOT, "index.html");
const DEV_ROUTE_RE =
  /^\/(?:|login|signup|forgot-password|reset-password|verify-email|paddy|milling|inventory|sales|dispatch|operators|costs|reports|users|employees|settings|admin(?:\/(?:tenants(?:\/[0-9a-f-]+)?|users|upgrade-requests|settings))?)\/?$/i;

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

function isAllowedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return false;
    if (isDev) {
      return parsed.origin === DEV_ORIGIN && DEV_ROUTE_RE.test(parsed.pathname);
    }
    if (parsed.protocol !== "file:" || parsed.host) return false;
    const candidate = path.resolve(fileURLToPath(parsed));
    const relative = path.relative(WEB_ROOT, candidate);
    if (candidate === APP_INDEX) return true;
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    // BrowserRouter may represent a logical SPA route as a path beside
    // index.html. No other local HTML/assets are valid top-level app frames.
    return DEV_ROUTE_RE.test(`/${relative.split(path.sep).join("/")}`);
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

function createWindow(): void {
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
    },
    titleBarStyle: "hiddenInset",
    title: "Rice Mill System",
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_ORIGIN);
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadFile(APP_INDEX);
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

  dbManager = initDatabase();
  syncEngine = new SyncEngine(dbManager, API_BASE, () => persistSession(null));
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
      const identity = await validateTokenWithServer(token, API_BASE);
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

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  syncEngine?.stop();
  if (process.platform !== "darwin") app.quit();
});
