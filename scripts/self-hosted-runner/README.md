# Self-hosted CI runner (`rice-ci`)

Every job in `.github/workflows/` runs on a GitHub Actions runner on the maintainer's PC instead
of on GitHub's machines. GitHub bills no Actions minutes for a self-hosted runner, so CI and the
deploys cost nothing however often they run. (In December 2025 GitHub announced a per-minute fee
for self-hosted runners on private repositories, then postponed it. If it ever starts, this is
the setup it would affect.)

## What it is

- A WSL distro, `rice-runner` (Ubuntu 24.04), at `D:\WSL\rice-runner`, separate from Docker
  Desktop's.
- Inside it: Docker Engine, and the GitHub Actions runner as a systemd service under the user
  `runner`, with the label `rice-ci`. It runs one job at a time, so a CI run's jobs go one
  after another.
- `/etc/wsl.conf` turns off the Windows drives under `/mnt` and running Windows programs, since
  CI runs code from pull requests and new dependency versions.
- `%LOCALAPPDATA%\rice-ci\keep-alive.cmd`, started from the Startup folder ("rice-ci runner"),
  keeps the distro running while you're logged in and starts it again after a `wsl --shutdown`.
- A weekly `docker system prune --all` timer; Docker's build cache is capped at 20 GB.
- Its ports (5432, 8000, 8001, 8449) are the distro's own, not Windows' (WSL's NAT networking),
  so the local Postgres and the :8000/:8448 dev servers aren't affected.

## Set it up, or repair it

```powershell
powershell -ExecutionPolicy Bypass -File scripts\self-hosted-runner\setup.ps1
```

It needs WSL 2 and `gh` logged in as an admin of the repository, and no administrator rights. It
is safe to run again: each step skips what is already in place.

## When the PC is off

Jobs wait for the runner for up to 24 hours, then fail. To use GitHub's runners meanwhile, which
bills minutes against the account's Actions budget, set the repository variable `CI_RUNNER` to
`ubuntu-latest` (Settings > Secrets and variables > Actions > Variables), and delete it when the
PC is back.

## Day to day

- Status: Settings > Actions > Runners, or `gh api repos/KS6903/RICE/actions/runners`.
- Runner log: `wsl -d rice-runner -u root -- journalctl -u 'actions.runner.*' -f`
- A shell on it: `wsl -d rice-runner`
- Stop it until the next login: end the keep-alive first (Task Manager, the "Windows Command
  Processor" running `keep-alive.cmd`), then `wsl --terminate rice-runner`. Terminating it alone
  only restarts it within half a minute.

## How it differs from GitHub's runners

GitHub starts each job on a fresh machine; this one is reused. So:

- Each Python job installs into a virtualenv of its own, because setup-python's interpreter is
  shared by every job here.
- The `docker` job removes an `api` container an interrupted run left behind.
- `job-started.sh` runs before every job and hands back files that a container job (`semgrep`)
  left owned by root, which the next checkout couldn't clean up otherwise.
- Python, Node and Playwright's browsers stay cached after the first run.

## Remove it

1. Set `CI_RUNNER` to `ubuntu-latest`, or the workflows wait for a runner that is gone.
2. Settings > Actions > Runners > the runner > Remove (or
   `gh api -X DELETE repos/KS6903/RICE/actions/runners/<id>`).
3. Delete the Startup entry "rice-ci runner" and `%LOCALAPPDATA%\rice-ci`, and end the
   keep-alive.
4. `wsl --unregister rice-runner`, which deletes the distro and its disk.
