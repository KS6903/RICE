#!/usr/bin/env node
// Package the desktop app for one API, with updates only when it's signed.
//
//   ORYZA_API_ORIGIN    required. The API this build talks to: https://app.example.com
//   ORYZA_UPDATE_URL    optional. Where latest.yml and the installers are served.
//   ORYZA_PUBLISHER     with ORYZA_UPDATE_URL: the code-signing certificate's
//                       subject name. electron-updater installs only installers
//                       signed by it, so a compromised feed can't push code.
//   CSC_LINK (or WIN_CSC_LINK) and CSC_KEY_PASSWORD
//                       the certificate itself, read by electron-builder.
//
// An update feed without a certificate is refused: an unsigned build has
// nothing for the updater to check an installer against.
//
// Usage, from packages/desktop:  node scripts/build-desktop.mjs [electron-builder args]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const isWindows = process.platform === "win32";

function fail(message) {
  console.error(`build-desktop: ${message}`);
  process.exit(1);
}

function run(command, args, env = process.env) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: desktop,
    env,
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.status !== 0) fail(`${command} ${args[0] ?? ""} failed`);
}

const apiOrigin = process.env.ORYZA_API_ORIGIN;
const updateUrl = process.env.ORYZA_UPDATE_URL || "";
const publisher = process.env.ORYZA_PUBLISHER || "";
if (!apiOrigin)
  fail("set ORYZA_API_ORIGIN to the API this build talks to, e.g. https://app.example.com");
if (updateUrl) {
  let parsed;
  try {
    parsed = new URL(updateUrl);
  } catch {
    fail("ORYZA_UPDATE_URL is not a URL");
  }
  if (parsed.protocol !== "https:") fail("ORYZA_UPDATE_URL must use https");
  if (!publisher)
    fail("ORYZA_UPDATE_URL needs ORYZA_PUBLISHER, the signing certificate's subject name");
  if (!process.env.CSC_LINK && !process.env.WIN_CSC_LINK) {
    fail(
      "ORYZA_UPDATE_URL needs a code-signing certificate (CSC_LINK or WIN_CSC_LINK): updates are signed or off",
    );
  }
}

// The web bundle reads ORYZA_API_ORIGIN for its CSP (the warehouse socket).
run("npm", ["run", "build:web"]);
run("npm", ["run", "build:main"]);

// Validate with the app's own rules (main/config.ts), then bake it in.
const { parseConfig } = createRequire(import.meta.url)(path.join(desktop, "main", "config.js"));
let config;
try {
  config = parseConfig({ apiOrigin, updates: Boolean(updateUrl) }, { packaged: true });
} catch (error) {
  fail(`ORYZA_API_ORIGIN: ${error.message}`);
}
writeFileSync(
  path.join(desktop, "main", "build-config.json"),
  `${JSON.stringify(config, null, 2)}\n`,
);
console.log(
  `build-desktop: API ${config.apiOrigin}; updates ${config.updates ? "on, signed" : "off"}`,
);

const builderArgs = ["--publish", "never"];
if (updateUrl) {
  builderArgs.push(
    "-c.publish.provider=generic",
    `-c.publish.url=${updateUrl}`,
    `-c.win.signtoolOptions.publisherName=${publisher}`,
  );
}
// electron-builder's own entry point, run by node without a shell, so a
// publisher name with spaces stays one argument.
const require = createRequire(import.meta.url);
const builderPackage = require.resolve("electron-builder/package.json");
const builderBin = JSON.parse(readFileSync(builderPackage, "utf8")).bin["electron-builder"];
const cli = path.join(path.dirname(builderPackage), builderBin);
console.log(`$ electron-builder ${builderArgs.join(" ")}`);
const built = spawnSync(process.execPath, [cli, ...builderArgs, ...process.argv.slice(2)], {
  cwd: desktop,
  stdio: "inherit",
});
if (built.status !== 0) fail("electron-builder failed");
