#!/usr/bin/env bash
# Runs before every job on the rice-ci runner (ACTIONS_RUNNER_HOOK_JOB_STARTED,
# set in the runner's .env by provision.sh).
#
# A job that runs in a container (checks.yml's semgrep) checks the repository
# out as the container's root user, so it leaves root-owned files in the work
# directory that every job shares. GitHub's runners start each job on a fresh
# machine; this one is reused, and the next job's checkout, as the runner
# user, couldn't clean those files up. Hand them back first.
set -eu

work="$(dirname "$(readlink -f "$0")")/actions-runner/_work"
if [ -d "$work" ] && [ -n "$(find "$work" -xdev ! -user runner -print -quit)" ]; then
  sudo chown -R runner:runner "$work"
fi
