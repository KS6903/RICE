# Desktop local-data security

Desktop sync credentials are accepted only by the Electron main process, checked
against `/api/auth/me`, and stored with Electron `safeStorage` when operating-system
encryption is available. Logging deliberately omits Axios request/response objects,
because those objects contain the Bearer credential and may contain business data.

SQLite data is partitioned into a separate, non-guessable database file for each
company-and-user identity. Switching accounts closes the previous handle before the
new partition is opened. The old unpartitioned `rice-mill-local.db` is migrated only
after a server-validated identity is active. Migration requires the file to contain
exactly that company and authenticated user, checkpoints its WAL, verifies the copy,
and renames the original to `rice-mill-legacy-<partition>.bak`. Mixed-company or
mismatched files fail closed and require a reviewed manual export. Delete the backup
only after the new partition has synced and the retention policy permits destruction.

## Where the app runs, and what it talks to

The packaged renderer loads from `app://oryza`, a privileged scheme the main process serves
(`main/appProtocol.ts`): the web bundle's files, `index.html` for the app's routes, and nothing
outside the bundle. Requests to `app://oryza/api/...` are forwarded by the main process to the API
fixed at build time (`ORYZA_API_ORIGIN`, https only), with the page's own `Origin`, `Referer` and
`Cookie` removed and the app's version added (`X-Client-Version`). The renderer is same-origin with
its API, so the API never has to accept the opaque `null` origin a `file://` page sends, which
would also admit every sandboxed page on the web. Only the warehouse WebSocket connects to the API
directly, with the bearer token as a subprotocol, never in the URL.

Below the server's `DESKTOP_MIN_VERSION`, every request gets 426 and the app asks to be updated.

## Sync that doesn't stall

A record the server refuses on its own (422, 413, or a 403 marked `X-Sync-Rejection: record`) is
found by halving the batch, kept locally with `_synced = 2`, and noted in `_sync_quarantine` with
the reason; the rest of the batch syncs. A pulled record this device can't apply is rolled back
alone and noted without its payload. Anything else (offline, session over, plan lapsed, a refusal
of the account) stops the run as before. After an update, set-aside records are retried.

## Updates

Auto-update is off unless the build was made with an update feed **and** a code-signing
certificate (`scripts/build-desktop.mjs` refuses a feed without one). The publisher name is baked
into the build, and electron-updater installs only installers signed by it, so whoever controls
the feed still can't ship code. Unsigned builds never update themselves.

## Encryption limitation

The app's SQLite is `node:sqlite`, built into Electron, which has no SQLCipher, so the local
database, WAL, and shared-memory files are **not encrypted by the application**.
They rely on the operating system's per-user application-data permissions and full-
disk encryption (BitLocker, FileVault, or an equivalent). Deployments that store
sensitive financial or personal data offline must enable full-disk encryption and
protect the OS login. A future SQLCipher build should encrypt every partition and
its journal before offline storage is treated as safe on an unencrypted device.
