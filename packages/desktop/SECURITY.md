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

## Encryption limitation

`better-sqlite3` does not provide SQLCipher encryption in this build, so the local
database, WAL, and shared-memory files are **not encrypted by the application**.
They rely on the operating system's per-user application-data permissions and full-
disk encryption (BitLocker, FileVault, or an equivalent). Deployments that store
sensitive financial or personal data offline must enable full-disk encryption and
protect the OS login. A future SQLCipher build should encrypt every partition and
its journal before offline storage is treated as safe on an unencrypted device.
