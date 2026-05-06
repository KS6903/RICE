import { app, BrowserWindow, ipcMain, net } from "electron";
import path from "path";
import { initDatabase } from "./database/sqlite";
import { registerIpcHandlers } from "./ipc/handlers";
import { SyncEngine } from "./sync/engine";

let mainWindow: BrowserWindow | null = null;
let syncEngine: SyncEngine | null = null;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
    title: "Rice Mill System",
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../web/dist/index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const db = initDatabase();
  registerIpcHandlers(db);
  syncEngine = new SyncEngine(db);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  syncEngine?.stop();
  if (process.platform !== "darwin") app.quit();
});
