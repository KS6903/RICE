import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  db: {
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke("db:query", sql, params),
    isSetup: () => ipcRenderer.invoke("db:isSetup"),
  },
  palay: {
    getPurchases: () => ipcRenderer.invoke("palay:getPurchases"),
  },
  milling: {
    getBatches: () => ipcRenderer.invoke("milling:getBatches"),
  },
  inventory: {
    getSummary: () => ipcRenderer.invoke("inventory:getSummary"),
  },
  sync: {
    setToken: (token: string) => ipcRenderer.invoke("sync:setToken", token),
  },
  isElectron: true,
});
