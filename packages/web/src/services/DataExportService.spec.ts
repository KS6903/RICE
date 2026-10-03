import { describe, expect, it } from "vitest";
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
    expect(filename).toMatch(/^oryza-data-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});
