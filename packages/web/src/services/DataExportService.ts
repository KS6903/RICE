// DataExportService — the owner's full data export, downloaded as one ZIP.
import api from "./api";

export class DataExportService {
  constructor(private http = api) {}

  /** The ZIP, and the file name the server gave it. */
  async download(): Promise<{ blob: Blob; filename: string }> {
    const res = await this.http.get("/export", { responseType: "blob" });
    const disposition: string = res.headers["content-disposition"] ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const today = new Date().toISOString().slice(0, 10);
    return { blob: res.data, filename: match?.[1] ?? `oryza-data-${today}.zip` };
  }
}

export const dataExportService = new DataExportService();
