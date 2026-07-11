import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  db: {
    // SECURITY: a generic `query(sql, params)` bridge used to live here. It let
    // the renderer run ARBITRARY SQL against local SQLite, so any XSS in the web
    // app meant full read/write of the local database. It has been removed. Expose
    // typed, parameterized channels per operation instead (see palay/milling/
    // inventory below) — never a pass-through SQL string.
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
    clearToken: () => ipcRenderer.invoke("sync:clearToken"),
  },
  isElectron: true,
});
