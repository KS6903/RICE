// Signed updates, for builds made with them (scripts/build-desktop.mjs).
//
// The update feed and the publisher the installer must be signed by are baked
// into the build (app-update.yml): electron-updater refuses an installer that
// isn't signed by that publisher, so a compromised feed can't push code. A
// build without them, or a development run, never checks.
import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface Updates {
  /** Check now, e.g. when the server says this build is too old. */
  checkNow(): void;
  readonly enabled: boolean;
}

export function startUpdates(enabled: boolean): Updates {
  if (!enabled || !app.isPackaged) return { enabled: false, checkNow: () => {} };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", () => {
    // The message can carry the feed URL and local paths; the kind is enough.
    console.error("[updater] update check failed");
  });
  autoUpdater.on("update-downloaded", (info) => {
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `Version ${info.version} is ready.`,
        detail: "Restart to finish updating. Otherwise it installs the next time you quit.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => console.error("[updater] update check failed"));
  };
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
  return { enabled: true, checkNow: check };
}
