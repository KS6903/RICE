import { app, BrowserWindow, Menu, ipcMain, safeStorage, shell } from "electron";
import path from "path";
import fs from "fs";
import { initDatabase } from "./database/sqlite";
import { registerIpcHandlers } from "./ipc/handlers";
import { SyncEngine } from "./sync/engine";

let mainWindow: BrowserWindow | null = null;
let syncEngine: SyncEngine | null = null;

const isDev = !app.isPackaged;
const DEV_ORIGIN = "http://localhost:8448";

// ── Sync-token storage (security hardening P1.10) ────────────────────────────
// The sync token is encrypted with the OS keychain (DPAPI on Windows, Keychain
// on macOS) via safeStorage — never written to disk in plaintext. If the OS
// can't encrypt, we keep the token in memory only for the session.

const tokenFile = () => path.join(app.getPath("userData"), "sync-token.bin");

function persistSyncToken(token: string): void {
  try {
    if (!token) {
      fs.rmSync(tokenFile(), { force: true });
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) return; // memory-only fallback
    fs.writeFileSync(tokenFile(), safeStorage.encryptString(token));
  } catch (err) {
    console.error("[main] failed to persist sync token:", err);
  }
}

function loadSyncToken(): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return "";
    if (!fs.existsSync(tokenFile())) return "";
    return safeStorage.decryptString(fs.readFileSync(tokenFile()));
  } catch {
    return "";
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      // Defense-in-depth renderer isolation: the web content runs sandboxed,
      // with no Node access, and can only reach the main process through the
      // typed contextBridge API in preload/index.ts.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: "hiddenInset",
    title: "Rice Mill System",
  });

  if (isDev) {
    mainWindow.loadURL(DEV_ORIGIN);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../web/dist/index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Navigation hardening ──────────────────────────────────────────────────────
// Applies to every webContents the app ever creates: new windows are denied
// (https links open in the system browser instead), and in-window navigation is
// locked to the app's own origin so a compromised renderer can't be steered to
// an attacker page running with our preload bridge.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_ORIGIN) : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
});

app.whenReady().then(async () => {
  // No application menu in packaged builds (also removes the View > DevTools
  // accelerator). Dev keeps the menu for debugging convenience.
  if (!isDev) Menu.setApplicationMenu(null);

  const db = initDatabase();
  registerIpcHandlers(db);
  syncEngine = new SyncEngine(db);

  // Restore the sync session from the OS-encrypted token, if present.
  const restored = loadSyncToken();
  if (restored) syncEngine.setToken(restored);

  // Renderer hands the backend token to the sync engine after login; persist it
  // encrypted so sync survives app restarts.
  ipcMain.handle("sync:setToken", (_event, token: string) => {
    syncEngine?.setToken(token || "");
    persistSyncToken(token || "");
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
