import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { DataExportService } from "./DataExportService";

function serviceReturning(headers: Record<string, string>) {
  const blob = new Blob(["zip"]);
  const http = { get: async () => ({ data: blob, headers }) };
  return { blob, service: new DataExportService(http as never) };
}

describe("DataExportService.download", () => {
  it("keeps the file name the server chose", async () => {
    const { blob, service } = serviceReturning({
      "content-disposition": 'attachment; filename="rice-mill-1-data-2026-10-03.zip"',
    });
    await expect(service.download()).resolves.toEqual({
      blob,
      filename: "rice-mill-1-data-2026-10-03.zip",
    });
  });

  it("names it by date when the header isn't readable", async () => {
    const { service } = serviceReturning({});
    const { filename } = await service.download();
    expect(filename).toMatch(/^oraiza-data-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});

describe("DataExportService backups", () => {
  it("keeps the backup's file name, or names it by date", async () => {
    const { service } = serviceReturning({
      "content-disposition": 'attachment; filename="rice-mill-1-backup-2026-10-20.oraiza"',
    });
    expect((await service.downloadBackup()).filename).toBe("rice-mill-1-backup-2026-10-20.oraiza");
    const { filename } = await serviceReturning({}).service.downloadBackup();
    expect(filename).toMatch(/^oraiza-backup-\d{4}-\d{2}-\d{2}\.oraiza$/);
  });

  it("keeps the server's reason when it refuses a download", async () => {
    const refusal = new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 400,
      data: new Blob([JSON.stringify({ detail: "Add an email address first." })], {
        type: "application/json",
      }),
    } as never);
    const http = {
      get: async () => {
        throw refusal;
      },
    };
    await expect(new DataExportService(http as never).downloadBackup()).rejects.toMatchObject({
      response: { data: { detail: "Add an email address first." } },
    });
  });

  function posting() {
    const calls: { url: string; form: FormData; config: any }[] = [];
    const http = {
      post: async (url: string, form: FormData, config: any) => {
        calls.push({ url, form, config });
        return { data: { rows: 1 } };
      },
    };
    return { calls, service: new DataExportService(http as never) };
  }

  it("sends the file as a form, not JSON, to be checked", async () => {
    const { calls, service } = posting();
    const file = new File(["sealed"], "mill.oraiza");
    await service.inspectBackup(file);
    expect(calls[0].url).toBe("/backup/inspect");
    expect(calls[0].form.get("file")).toBeInstanceOf(File);
    expect(calls[0].config.headers["Content-Type"]).toBe("multipart/form-data");
  });

  it("sends the password, and the code only when there is one, to restore", async () => {
    const { calls, service } = posting();
    const file = new File(["sealed"], "mill.oraiza");
    await service.restoreBackup(file, { password: "secret" });
    await service.restoreBackup(file, { password: "secret", code: "123456" });
    expect(calls[0].url).toBe("/backup/restore");
    expect(calls[0].form.get("current_password")).toBe("secret");
    expect(calls[0].form.has("mfa_code")).toBe(false);
    expect(calls[1].form.get("mfa_code")).toBe("123456");
  });
});
