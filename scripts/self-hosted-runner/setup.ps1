<#
.SYNOPSIS
  Builds, or repairs, the self-hosted GitHub Actions runner "rice-ci" on this PC.

.DESCRIPTION
  Every workflow in this repository runs on the runner labelled rice-ci (see
  README.md beside this script). This script:
    1. creates the WSL distro rice-runner (Ubuntu 24.04) at -Location;
    2. runs provision.sh in it as root: Docker Engine, the runner as a systemd
       service, a weekly Docker clean-up, and an /etc/wsl.conf that cuts the
       distro off from the Windows drives and programs;
    3. adds a Startup-folder entry that keeps the distro running while you're
       logged in (WSL stops a distro nothing is using), and starts it now.
  Safe to run again: each step skips what is already in place.

  Needs WSL 2, and gh logged in with admin rights on the repository (for the
  one-time registration token). No administrator rights.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\self-hosted-runner\setup.ps1
#>
param(
  [string]$Repo = "KS6903/RICE",
  [string]$Distro = "rice-runner",
  # On the SSD: on the D: hard drive, pytest's Postgres traffic made the
  # backend job crawl (78 minutes without finishing, mostly I/O wait).
  [string]$Location = "C:\WSL\rice-runner",
  [string]$Label = "rice-ci",
  [string]$RunnerName = ("$env:COMPUTERNAME-wsl").ToLower()
)

$ErrorActionPreference = "Stop"
# wsl.exe prints UTF-16 unless told otherwise, which PowerShell 5.1 garbles.
$env:WSL_UTF8 = "1"

function Invoke-Wsl {
  & wsl.exe @args
  # Not the arguments: one of them can be the registration token.
  if ($LASTEXITCODE -ne 0) { throw "wsl failed with exit code $LASTEXITCODE" }
}

function Get-Distros {
  (wsl.exe --list --quiet) | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

function Get-DefaultDistro {
  $line = (wsl.exe --list --verbose) | Where-Object { $_ -match '^\s*\*' } | Select-Object -First 1
  if ($line) { (($line -replace '^\s*\*\s*', '') -split '\s+')[0] }
}

Write-Host "== WSL distro $Distro"
if ((Get-Distros) -notcontains $Distro) {
  $default = Get-DefaultDistro
  New-Item -ItemType Directory -Force (Split-Path $Location) | Out-Null
  Invoke-Wsl --install Ubuntu-24.04 --name $Distro --location $Location --no-launch
  # Docker Desktop hooks its own docker CLI into the default distro, which
  # would clash with this distro's engine, so keep the default as it was.
  if ($default -and (Get-DefaultDistro) -ne $default) { Invoke-Wsl --set-default $default }
}

# provision.sh needs systemd running (docker and the runner are services).
$pid1 = wsl.exe -d $Distro -u root --exec ps -p 1 -o comm=
if ("$pid1".Trim() -ne "systemd") {
  Write-Host "== Turning on systemd in $Distro"
  Invoke-Wsl -d $Distro -u root --exec sh -c "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
  Invoke-Wsl --terminate $Distro
}

Write-Host "== Provisioning (Docker, the runner, clean-up)"
# Let the boot finish first: it empties /tmp on the way. "degraded" exits
# non-zero and is fine here.
wsl.exe -d $Distro -u root --exec systemctl is-system-running --wait | Out-Null
# /var/tmp, unlike /tmp, survives a boot. A fresh folder each run, because
# files written through \\wsl.localhost belong to the distro's default user.
$copy = "/var/tmp/rice-ci-" + [guid]::NewGuid().ToString("N")
$share = "\\wsl.localhost\$Distro" + ($copy -replace "/", "\")
New-Item -ItemType Directory -Force $share | Out-Null
Copy-Item -Force "$PSScriptRoot\provision.sh", "$PSScriptRoot\job-started.sh" $share

wsl.exe -d $Distro -u root --exec test -f /home/runner/actions-runner/.runner
$token = ""
if ($LASTEXITCODE -ne 0) {
  $token = gh api -X POST "repos/$Repo/actions/runners/registration-token" --jq .token
  if ($LASTEXITCODE -ne 0 -or -not $token) {
    throw "Couldn't get a runner registration token for $Repo. Is gh logged in (gh auth status) as an admin of the repository?"
  }
}
try {
  Invoke-Wsl -d $Distro -u root --exec env "RUNNER_REPO=$Repo" "RUNNER_LABEL=$Label" `
    "RUNNER_NAME=$RunnerName" "RUNNER_TOKEN=$token" bash "$copy/provision.sh"
} finally {
  Remove-Item -Recurse -Force $share -ErrorAction SilentlyContinue
}

# The new /etc/wsl.conf (no Windows drives or programs) applies from the next start.
Invoke-Wsl --terminate $Distro

Write-Host "== Keeping $Distro running while you're logged in"
$keepDir = Join-Path $env:LOCALAPPDATA "rice-ci"
New-Item -ItemType Directory -Force $keepDir | Out-Null
$keep = Join-Path $keepDir "keep-alive.cmd"
@"
@echo off
rem Keeps the $Distro WSL distro, and so the $Label runner, running while you're
rem logged in, and starts it again after a "wsl --shutdown". Written by
rem scripts\self-hosted-runner\setup.ps1 in the RICE repository.
:loop
wsl.exe -d $Distro --exec /bin/sleep infinity
ping -n 31 127.0.0.1 >nul
goto loop
"@ | Set-Content -Encoding ascii $keep

$conhost = "$env:WINDIR\System32\conhost.exe"
$keepArgs = "--headless cmd.exe /d /c `"$keep`""
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut(
  (Join-Path ([Environment]::GetFolderPath("Startup")) "rice-ci runner.lnk"))
$shortcut.TargetPath = $conhost
$shortcut.Arguments = $keepArgs
$shortcut.Description = "Keeps the rice-ci GitHub Actions runner (WSL distro $Distro) running"
$shortcut.Save()

$running = Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
  Where-Object { $_.CommandLine -like "*$keep*" }
if (-not $running) { Start-Process -FilePath $conhost -ArgumentList $keepArgs -WindowStyle Hidden }

Write-Host "== Waiting for GitHub to list $RunnerName as online"
$deadline = (Get-Date).AddMinutes(3)
do {
  Start-Sleep -Seconds 5
  $runner = (gh api "repos/$Repo/actions/runners" | ConvertFrom-Json).runners |
    Where-Object { $_.name -eq $RunnerName }
} until (($runner -and $runner.status -eq "online") -or (Get-Date) -gt $deadline)

if ($runner -and $runner.status -eq "online") {
  $labels = ($runner.labels | ForEach-Object { $_.name }) -join ", "
  Write-Host "Runner $RunnerName is online ($labels)."
} else {
  throw "Runner $RunnerName isn't online yet. Logs: wsl -d $Distro -u root -- journalctl -u 'actions.runner.*' -n 50"
}
