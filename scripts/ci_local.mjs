#!/usr/bin/env node
// Local mirror of .github/workflows/checks.yml. The pre-push hook
// (.githooks/pre-push) runs it before anything is pushed to main; run it by
// hand with `npm run ci:local`. Keep the step list in step with checks.yml.
//
// Deliberate differences from CI:
//   - pytest uses backend/.env (conftest's "<db> Test" sibling database),
//     never CI's DATABASE_URL.
//   - The API e2e suite runs against "ricemill_e2e" on the server named in
//     backend/.env. The launcher drops and recreates only databases whose
//     name contains "e2e".
//   - Semgrep and Docker run only when installed; CI always runs them.
//     gitleaks is required: a leaked secret must never leave this machine.
//
// Flags:
//   --fast        skip the slow steps (pytest, e2e, production build, Docker)
//   --sha <sha>   refuse to run unless HEAD is that commit (the hook passes the
//                 commit being pushed, so what is checked is what is pushed)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const isWindows = process.platform === "win32";
const python = path.join(backend, ".venv", isWindows ? "Scripts\\python.exe" : "bin/python");

const args = process.argv.slice(2);
const fast = args.includes("--fast");
const expectedSha = args.includes("--sha") ? args[args.indexOf("--sha") + 1] : null;

const results = [];

function fail(message) {
  console.error(`\nci:local: ${message}`);
  process.exit(1);
}

function run(cmd, cmdArgs, { cwd = root, env, shell = false } = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: "inherit",
    shell,
  });
  return res.status === 0;
}

function capture(cmd, cmdArgs, { cwd = root, shell = false } = {}) {
  const res = spawnSync(cmd, cmdArgs, { cwd, encoding: "utf8", shell });
  return { ok: res.status === 0, out: (res.stdout || "").trim() };
}

/** Run one named step; stop at the first required failure. */
function step(name, fn, { advisory = false } = {}) {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 66 - name.length))}`);
  const started = Date.now();
  const ok = fn();
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  results.push({ name, status: ok ? "pass" : advisory ? "advisory" : "FAIL", seconds });
  if (!ok && !advisory) summarize(1);
}

function skip(name, why) {
  console.log(`\n── ${name}: skipped (${why})`);
  results.push({ name, status: "skipped", seconds: "-" });
}

function summarize(code) {
  console.log("\nci:local summary");
  for (const r of results)
    console.log(`  ${r.status.padEnd(8)} ${String(r.seconds).padStart(4)}s  ${r.name}`);
  console.log(
    code === 0 ? "\nci:local: all required checks passed." : "\nci:local: a required check failed.",
  );
  process.exit(code);
}

const npm =
  (script, extra = []) =>
  () =>
    run("npm", ["run", script, ...extra], { shell: isWindows });
const py =
  (module, pyArgs, cwd = backend) =>
  () =>
    run(python, ["-m", module, ...pyArgs], { cwd });

function onPath(tool) {
  return capture(isWindows ? "where" : "which", [tool]).ok;
}

function e2eDatabaseUrl() {
  // Same server and credentials as backend/.env, a dedicated disposable DB.
  const envFile = path.join(backend, ".env");
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) return null;
  const raw = line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  try {
    const url = new URL(raw);
    url.pathname = "/ricemill_e2e";
    return url.toString();
  } catch {
    return null;
  }
}

// ── Preconditions ────────────────────────────────────────────────────────────

const dirty = capture("git", ["status", "--porcelain", "--untracked-files=no"]);
if (dirty.out) {
  fail(
    "the working tree has uncommitted changes, so these checks would not test what you push. Commit or stash them first.",
  );
}
if (expectedSha) {
  const head = capture("git", ["rev-parse", "HEAD"]).out;
  if (head !== expectedSha) {
    fail(
      `HEAD is ${head.slice(0, 12)} but the push is ${expectedSha.slice(0, 12)}. Check out the commit you are pushing, then push again.`,
    );
  }
}
if (!existsSync(python)) {
  fail(`no backend virtualenv at ${python}. Create it (see SETUP.md), then retry.`);
}
const pyVersion = capture(python, ["-c", "import sys; print('%d.%d' % sys.version_info[:2])"]).out;
if (pyVersion !== "3.11") {
  console.warn(
    `ci:local: note: backend venv is Python ${pyVersion}; CI and the container use 3.11.`,
  );
}
const untracked = capture("git", ["ls-files", "--others", "--exclude-standard"]).out;
if (untracked) {
  console.warn(
    "ci:local: note: untracked files are present; they are included in these checks but not in the push.",
  );
}

// ── Backend (checks.yml: backend) ────────────────────────────────────────────

step("backend: lockfiles match their inputs", () =>
  run(python, [path.join("scripts", "check_lockfiles.py")], { cwd: backend }),
);
step("backend: ruff (scoped)", py("ruff", ["check", "tests"]));
step("backend: mypy (scoped)", py("mypy", []));
step("backend: single Alembic head", () => {
  const heads = capture(python, ["-m", "alembic", "heads"], { cwd: backend });
  console.log(heads.out);
  return heads.ok && heads.out.split(/\r?\n/).filter(Boolean).length === 1;
});
if (fast) skip("backend: pytest", "--fast");
else step("backend: pytest", py("pytest", []));

// ── Frontend (checks.yml: frontend) ──────────────────────────────────────────

if (fast) step("web: type-check", npm("typecheck", ["--workspace=packages/web"]));
else step("web: production build (type-check + bundle)", npm("build:web"));
step("web: unit tests (Vitest)", npm("test:web"));
step("web: ESLint (zero warnings)", npm("lint", ["--workspace=packages/web"]));
step("worker: type-check", npm("cf:typecheck"));
if (fast) skip("worker: bundle (dry run)", "--fast (needs the production build)");
else {
  step("worker: bundle (dry run)", () => {
    const outdir = mkdtempSync(path.join(tmpdir(), "oryza-worker-"));
    try {
      return run(
        "npx",
        ["wrangler", "deploy", "--dry-run", "--containers-rollout=none", "--outdir", `"${outdir}"`],
        {
          shell: true,
          env: { WRANGLER_SEND_METRICS: "false" },
        },
      );
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
}
step("desktop: type-check", () =>
  run("npx", ["tsc", "-p", "packages/desktop/tsconfig.json", "--noEmit"], { shell: isWindows }),
);
step("format check (advisory until the format migration)", npm("format:check"), { advisory: true });

// ── Security (checks.yml: security, semgrep) ─────────────────────────────────

step(
  "security: pip-audit",
  py("pip_audit", ["-r", "backend/requirements.txt", "--disable-pip", "--require-hashes"], root),
);
step("security: bandit", py("bandit", ["-r", "backend/app", "-ll", "-q"], root));
step("security: gitleaks (full history)", () => {
  const bin = process.env.GITLEAKS_BIN || "gitleaks";
  if (!process.env.GITLEAKS_BIN && !onPath("gitleaks")) {
    console.error(
      "gitleaks is not installed, and it is required: secrets must be caught before they are pushed.\n" +
        (isWindows
          ? "  Install: winget install --id Gitleaks.Gitleaks   (or set GITLEAKS_BIN to the binary)"
          : "  Install: https://github.com/gitleaks/gitleaks#installing   (or set GITLEAKS_BIN)"),
    );
    return false;
  }
  return run(bin, ["git", "--redact", "--no-banner", "--exit-code", "1", "."]);
});
step("security: npm audit", () => run("npm", ["audit", "--omit=dev"], { shell: isWindows }));
if (onPath("semgrep")) {
  step("security: Semgrep", () =>
    run(
      "semgrep",
      [
        "scan",
        "--config",
        "p/python",
        "--config",
        "p/typescript",
        "--config",
        "p/react",
        "--metrics=off",
        "--error",
        "--quiet",
      ],
      {
        env: { PYTHONUTF8: "1" },
      },
    ),
  );
} else {
  skip("security: Semgrep", "not installed; CI runs it");
}

// ── Container image (checks.yml: docker) ─────────────────────────────────────

if (fast) skip("docker: build + boot", "--fast");
else if (!capture("docker", ["info"]).ok)
  skip("docker: build + boot", "Docker is not running; CI runs it");
else {
  step("docker: build + boot + /api/health", () => {
    const tag = "oryza-api:ci-local";
    const name = "oryza-api-ci-local";
    if (!run("docker", ["build", "-f", "backend/Dockerfile", "-t", tag, "."])) return false;
    capture("docker", ["rm", "-f", name]);
    const started = run("docker", [
      "run",
      "-d",
      "--name",
      name,
      "-p",
      "127.0.0.1:18000:8000",
      "-e",
      "DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/unused",
      "-e",
      "SECRET_KEY=ci-test-secret-key",
      "-e",
      "REDIS_URL=",
      tag,
    ]);
    if (!started) return false;
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (capture("curl", ["-fsS", "http://127.0.0.1:18000/api/health"]).ok) return true;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      }
      run("docker", ["logs", name]);
      return false;
    } finally {
      capture("docker", ["rm", "-f", name]);
    }
  });
}

// ── API end-to-end (checks.yml: e2e-api) ─────────────────────────────────────

if (fast) skip("e2e: API suite", "--fast");
else {
  const url = e2eDatabaseUrl();
  if (!url) fail("could not derive the e2e database from DATABASE_URL in backend/.env.");
  step("e2e: API suite", () =>
    run("npm", ["run", "test:e2e:api"], { shell: isWindows, env: { E2E_DATABASE_URL: url } }),
  );
}

summarize(0);
