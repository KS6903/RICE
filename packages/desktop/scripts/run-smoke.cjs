// Runs scripts/smoke.cjs in Electron. VS Code's terminal sets
// ELECTRON_RUN_AS_NODE, which would make Electron act as plain Node.
const { execFileSync } = require("child_process");
const path = require("path");

delete process.env.ELECTRON_RUN_AS_NODE;
try {
  execFileSync(require("electron"), [path.join(__dirname, "smoke.cjs")], { stdio: "inherit" });
} catch {
  process.exit(1);
}
