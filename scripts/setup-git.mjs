// Local git settings this repository relies on. Run by `npm install` through the
// root "prepare" script, so a fresh clone is set up without extra steps.
//   - core.hooksPath: unset, left over from the pre-push hook this repo used to have
//   - blame.ignoreRevsFile: `git blame` skips formatting-only commits
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const git = (args) => execSync(`git ${args}`, { stdio: "ignore" });

try {
  // CI on GitHub is the only gate now. A clone set up while the hook existed
  // still points core.hooksPath at .githooks, so clear it.
  try {
    git("config --unset core.hooksPath");
  } catch {
    // Not set: nothing to clear.
  }
  // Only once the file exists: git blame fails outright if it is missing.
  if (existsSync(".git-blame-ignore-revs")) {
    git("config blame.ignoreRevsFile .git-blame-ignore-revs");
  }
} catch {
  // Not a git checkout (a source archive, say): nothing to configure.
}
