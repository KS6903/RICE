import { describe, it, expect } from "vitest";
import { DispatchService } from "./DispatchService";

describe("DispatchService.toCourierBody", () => {
  it("maps an agent pick to agent_id only", () => {
    expect(DispatchService.toCourierBody({ kind: "agent", id: "a1" })).toEqual({
      agent_id: "a1",
      miller_id: null,
    });
  });
  it("maps a miller pick to miller_id only", () => {
    expect(DispatchService.toCourierBody({ kind: "miller", id: "m1" })).toEqual({
      agent_id: null,
      miller_id: "m1",
    });
  });
  it("clears both when pick is null", () => {
    expect(DispatchService.toCourierBody(null)).toEqual({ agent_id: null, miller_id: null });
  });
});

describe("DispatchService (DI-mocked http)", () => {
  it("routes operator CRUD to the right resource per kind", async () => {
    const calls: Array<[string, string]> = [];
    const fakeHttp = {
      get: (u: string) => {
        calls.push(["GET", u]);
        return Promise.resolve({ data: [] });
      },
      post: (u: string) => {
        calls.push(["POST", u]);
        return Promise.resolve({ data: {} });
      },
      put: (u: string) => {
        calls.push(["PUT", u]);
        return Promise.resolve({ data: {} });
      },
    } as any;
    const svc = new DispatchService(fakeHttp);

    await svc.listAgents(true);
    await svc.listMillers();
    await svc.createOperator("agent", { name: "A" });
    await svc.createOperator("miller", { name: "M" });
    await svc.updateOperator("agent", "a1", {});
    await svc.setOperatorActive("miller", "m1", false);

    expect(calls).toEqual([
      ["GET", "/agents?include_inactive=true"],
      ["GET", "/millers"],
      ["POST", "/agents"],
      ["POST", "/millers"],
      ["PUT", "/agents/a1"],
      ["PUT", "/millers/m1"],
    ]);
  });
});
