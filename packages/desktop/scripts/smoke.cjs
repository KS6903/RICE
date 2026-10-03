// Smoke test of the packaged app's app:// scheme, in real Electron.
//
// Unit tests can't see what Chromium does with a custom scheme; this can (it
// caught the app refusing all its own requests, because a custom scheme's
// origin reads as "null"). It serves the built web bundle through the compiled
// main/appProtocol.js, exactly as a packaged build does, loads it in a hidden
// window, and checks the page and the API path from inside it.
//
// Needs: the web bundle built (npm run build:web), main compiled
// (npm run build:main), and an API at SMOKE_API (default the local dev API).
// Run from packages/desktop:  npm run smoke
// (In a VS Code terminal, ELECTRON_RUN_AS_NODE is set and makes Electron act
// as plain Node; the npm script clears it.)
const { app, BrowserWindow } = require("electron");
const path = require("path");

const desktop = path.resolve(__dirname, "..");
const { registerAppScheme, serveApp } = require(path.join(desktop, "main", "appProtocol.js"));
const apiOrigin = process.env.SMOKE_API || "http://127.0.0.1:8000";

registerAppScheme();
let upgrades = 0;
const consoleErrors = [];

function verdict(result) {
  const problems = [];
  if (result.url !== "app://oryza/") problems.push(`loaded ${result.url}`);
  if (!result.reactMounted) problems.push("React didn't mount");
  if (result.health !== 200) problems.push(`/api/health gave ${result.health}`);
  if (![401, 426].includes(result.authMe)) problems.push(`/api/auth/me gave ${result.authMe}`);
  // 401 (or 426, or 429) means the POST body reached the API; 422 means it didn't.
  if (![401, 426, 429].includes(result.loginPost))
    problems.push(`login POST gave ${result.loginPost}`);
  if (result.spaRoute !== "200 true") problems.push(`a deep link gave ${result.spaRoute}`);
  if (!result.traversalGivesIndex) problems.push("a traversal path escaped the bundle");
  if (!String(result.asset).startsWith("200 text/javascript"))
    problems.push(`the script asset gave ${result.asset}`);
  if (result.consoleErrors.length)
    problems.push(`console errors: ${result.consoleErrors.join(" | ")}`);
  return problems;
}

app.whenReady().then(async () => {
  let exitCode = 1;
  try {
    serveApp({
      webRoot: path.resolve(desktop, "..", "web", "dist"),
      apiOrigin,
      appVersion: require(path.join(desktop, "package.json")).version,
      onUpgradeRequired: () => {
        upgrades += 1;
      },
    });
    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.webContents.on("console-message", (event, level, message) => {
      const lvl = event && event.level !== undefined ? event.level : level;
      const msg = event && event.message !== undefined ? event.message : message;
      if (lvl === "error" || lvl === 3) consoleErrors.push(String(msg).slice(0, 200));
    });
    await win.loadURL("app://oryza/");
    await new Promise((resolve) => setTimeout(resolve, 3000)); // let React mount
    const result = await win.webContents.executeJavaScript(`(async () => {
      const out = { url: location.href, title: document.title };
      out.reactMounted = (document.getElementById("root")?.children.length ?? 0) > 0;
      out.health = (await fetch("/api/health")).status;
      out.authMe = (await fetch("/api/auth/me")).status;
      out.loginPost = (await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "username=smoke-test-nobody&password=wrong-password",
      })).status;
      const spa = await fetch("/settings/deep/link");
      out.spaRoute = spa.status + " " + (await spa.text()).includes('id="root"');
      out.traversalGivesIndex = (await (await fetch("/%2e%2e/%2e%2e/package.json")).text()).includes('id="root"');
      const src = document.querySelector('script[type="module"]')?.getAttribute("src");
      if (src) { const a = await fetch(src); out.asset = a.status + " " + a.headers.get("content-type"); }
      return out;
    })()`);
    const report = { apiOrigin, ...result, upgrades, consoleErrors };
    const problems = verdict(report);
    console.log(JSON.stringify(report, null, 2));
    console.log(
      problems.length ? `SMOKE FAILED:\n- ${problems.join("\n- ")}` : "Smoke test passed.",
    );
    exitCode = problems.length ? 1 : 0;
  } catch (error) {
    console.error("SMOKE FAILED:", error);
  } finally {
    app.exit(exitCode);
  }
});
