// Local git settings this repository relies on. Run by `npm install` through the
// root "prepare" script, so a fresh clone is set up without extra steps.
//   - core.hooksPath: enables .githooks/pre-push (the CI gate for main)
//   - blame.ignoreRevsFile: `git blame` skips formatting-only commits
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const git = (args) => execSync(`git ${args}`, { stdio: "ignore" });

try {
  git("config core.hooksPath .githooks");
  // Only once the file exists: git blame fails outright if it is missing.
  if (existsSync(".git-blame-ignore-revs")) {
    git("config blame.ignoreRevsFile .git-blame-ignore-revs");
  }
} catch {
  // Not a git checkout (a source archive, say): nothing to configure.
}
