import { describe, it, expect } from "vitest";
import { InventoryService } from "./InventoryService";

describe("InventoryService (DI-mocked http)", () => {
  it("builds branch-scoped URLs only when a branch is given", async () => {
    const calls: string[] = [];
    const fakeHttp = { get: (url: string) => { calls.push(url); return Promise.resolve({ data: [] }); } } as any;
    const svc = new InventoryService(fakeHttp);

    await svc.getMilledRice("b1");
    await svc.getMilledRice();
    await svc.getMilledRice("");
    await svc.getSummary("b2");

    expect(calls).toEqual([
      "/inventory/milled-rice?branch_id=b1",
      "/inventory/milled-rice",
      "/inventory/milled-rice",
      "/inventory/summary?branch_id=b2",
    ]);
  });
});
