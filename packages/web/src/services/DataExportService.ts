// DataExportService — the owner's full data export, downloaded as one ZIP, and
// the backup file: downloaded, checked and restored.
import { isAxiosError } from "axios";
import api from "./api";

/** What a backup file holds, as the server read it. */
export type BackupSummary = {
  company: string;
  created_at: string;
  created_by: string;
  rows: number;
  tables: number;
  /** Branches still open in the old mill: the new account's plan needs room. */
  branches: number;
};

/** Whether this account could take a backup now, and the email a backup it
 *  makes is tied to. */
export type BackupStatus = {
  empty: boolean;
  email: string | null;
  email_verified: boolean;
};

/** The owner's password, and a current authenticator code with two-factor on. */
export type RestoreProof = { password: string; code?: string };

function filenameFrom(headers: Record<string, unknown>, fallback: string): string {
  const disposition = String(headers["content-disposition"] ?? "");
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
}

/** FileReader rather than blob.text(), which the tests' DOM (jsdom) lacks. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** A file download asks for a Blob, so a refusal's JSON arrives as one too and
 *  the server's reason (`detail`) would be lost behind a generic message. Read
 *  it back into JSON before the error goes on. */
async function blobRefusalsAsJson<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (e) {
    if (isAxiosError(e) && e.response?.data instanceof Blob) {
      try {
        e.response.data = JSON.parse(await blobText(e.response.data));
      } catch {
        // Not JSON: the error stays as it came.
      }
    }
    throw e;
  }
}

function fileForm(file: File, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

// The client sends JSON by default, which would turn a FormData into JSON.
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

export class DataExportService {
  constructor(private http = api) {}

  /** The ZIP, and the file name the server gave it. */
  async download(): Promise<{ blob: Blob; filename: string }> {
    const res = await blobRefusalsAsJson(this.http.get("/export", { responseType: "blob" }));
    const today = new Date().toISOString().slice(0, 10);
    return { blob: res.data, filename: filenameFrom(res.headers, `oraiza-data-${today}.zip`) };
  }

  /** The backup file, and the file name the server gave it. */
  async downloadBackup(): Promise<{ blob: Blob; filename: string }> {
    const res = await blobRefusalsAsJson(this.http.get("/backup", { responseType: "blob" }));
    const today = new Date().toISOString().slice(0, 10);
    return { blob: res.data, filename: filenameFrom(res.headers, `oraiza-backup-${today}.oraiza`) };
  }

  async backupStatus(): Promise<BackupStatus> {
    const res = await this.http.get("/backup/status");
    return res.data;
  }

  /** Whether a backup would load into this account, and what it holds.
   *  Changes nothing. */
  async inspectBackup(file: File): Promise<BackupSummary> {
    const res = await this.http.post("/backup/inspect", fileForm(file), MULTIPART);
    return res.data;
  }

  /** Load the backup's records into this new, empty account. */
  async restoreBackup(file: File, proof: RestoreProof): Promise<BackupSummary> {
    const fields: Record<string, string> = { current_password: proof.password };
    if (proof.code) fields.mfa_code = proof.code;
    const res = await this.http.post("/backup/restore", fileForm(file, fields), MULTIPART);
    return res.data;
  }
}

export const dataExportService = new DataExportService();
