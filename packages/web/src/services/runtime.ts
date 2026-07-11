/** Runtime checks and the narrow desktop bridge used by browser-shared code. */
export function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.isElectron === true;
}

export async function setDesktopSyncToken(token: string): Promise<void> {
  if (!isElectronRuntime()) return;
  if (!token && window.electronAPI!.sync.clearToken) {
    await window.electronAPI!.sync.clearToken();
    return;
  }
  await window.electronAPI!.sync.setToken(token);
}
