#!/usr/bin/env bash
# Builds the rice-ci runner inside the rice-runner WSL distro. setup.ps1 copies
# this folder into the distro and runs it as root. Safe to run again: it only
# adds what is missing, and registers the runner only the first time.
#
# Environment (setup.ps1 passes these):
#   RUNNER_REPO    owner/name of the repository, e.g. KS6903/RICE
#   RUNNER_LABEL   the label the workflows ask for: rice-ci
#   RUNNER_NAME    how the runner is listed under Settings > Actions > Runners
#   RUNNER_TOKEN   a registration token (valid for an hour); needed only while
#                  the runner isn't registered yet
set -euo pipefail

: "${RUNNER_REPO:?}" "${RUNNER_LABEL:?}" "${RUNNER_NAME:?}"
here="$(cd "$(dirname "$0")" && pwd)"
runner_home=/home/runner
runner_dir="$runner_home/actions-runner"
export DEBIAN_FRONTEND=noninteractive

echo "== Ubuntu Pro and Landscape agents off (they slow every boot; not needed here)"
for unit in wsl-pro.service landscape-client.service; do
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
  systemctl mask "$unit" >/dev/null 2>&1 || true
done

echo "== Base packages"
apt-get update -q
apt-get install -y -q --no-install-recommends \
  ca-certificates curl git jq sudo tar unzip xz-utils zstd

echo "== Docker Engine (Docker's own packages, as on GitHub's Ubuntu image)"
if ! command -v dockerd >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin
fi
install -d /etc/docker
# The build cache trims itself; the weekly timer below removes unused images.
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "20GB" } }
}
EOF
systemctl enable docker >/dev/null
systemctl restart docker

echo "== The account jobs run as"
# Passwordless sudo, as on GitHub's runners (Playwright's --with-deps installs
# system libraries with it). The docker group is root-equivalent anyway: the
# boundary is the distro, which /etc/wsl.conf below cuts off from Windows.
id runner >/dev/null 2>&1 || useradd --create-home --shell /bin/bash runner
usermod -aG docker runner
echo "runner ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/runner
chmod 0440 /etc/sudoers.d/runner

echo "== GitHub Actions runner"
if [ ! -f "$runner_dir/.runner" ]; then
  : "${RUNNER_TOKEN:?a registration token is needed to register the runner}"
  release="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)"
  version="$(jq -r .tag_name <<<"$release")"
  version="${version#v}"
  sha="$(jq -r .body <<<"$release" |
    sed -n 's/.*<!-- BEGIN SHA linux-x64 -->\([0-9a-f]\{64\}\)<!-- END SHA linux-x64 -->.*/\1/p')"
  if [ -z "$sha" ]; then
    echo "The runner v$version release notes carry no linux-x64 checksum." >&2
    exit 1
  fi
  archive="$(mktemp)"
  curl -fsSL -o "$archive" \
    "https://github.com/actions/runner/releases/download/v${version}/actions-runner-linux-x64-${version}.tar.gz"
  echo "${sha}  ${archive}" | sha256sum -c -
  install -d -o runner -g runner "$runner_dir"
  tar -xzf "$archive" -C "$runner_dir"
  rm -f "$archive"
  chown -R runner:runner "$runner_dir"
  (cd "$runner_dir" && ./bin/installdependencies.sh)
  sudo -u runner -H "$runner_dir/config.sh" --unattended --replace \
    --url "https://github.com/${RUNNER_REPO}" --token "$RUNNER_TOKEN" \
    --name "$RUNNER_NAME" --labels "$RUNNER_LABEL" --work _work
fi

# Before each job: hand back files a container job left owned by root.
install -o runner -g runner -m 0755 "$here/job-started.sh" "$runner_home/job-started.sh"
touch "$runner_dir/.env"
sed -i '/^ACTIONS_RUNNER_HOOK_JOB_STARTED=/d' "$runner_dir/.env"
echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=$runner_home/job-started.sh" >>"$runner_dir/.env"
chown runner:runner "$runner_dir/.env"

cd "$runner_dir"
[ -f .service ] || ./svc.sh install runner
systemctl restart "$(cat .service)"

echo "== Weekly Docker clean-up"
cat >/etc/systemd/system/rice-ci-prune.service <<'EOF'
[Unit]
Description=Remove Docker images, containers and build cache that no CI job is using
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker system prune --all --force
EOF
cat >/etc/systemd/system/rice-ci-prune.timer <<'EOF'
[Unit]
Description=Weekly Docker clean-up for the rice-ci runner

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now rice-ci-prune.timer >/dev/null

echo "== Cut the distro off from Windows (applies from the next start)"
cat >/etc/wsl.conf <<'EOF'
# Written by scripts/self-hosted-runner/provision.sh.
[boot]
systemd=true

[user]
default=runner

# CI runs code from pull requests and new dependency versions: no Windows
# drives under /mnt, and no running Windows programs from here.
[automount]
enabled=false
mountFsTab=false

[interop]
enabled=false
appendWindowsPath=false
EOF

echo "== Done: runner '$RUNNER_NAME' with label '$RUNNER_LABEL' for $RUNNER_REPO"
