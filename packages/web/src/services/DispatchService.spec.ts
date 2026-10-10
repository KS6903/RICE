import { describe, expect, it } from "vitest";
import { DispatchService } from "./DispatchService";

describe("DispatchService.toCourierBody", () => {
  it("names the customer or the rice mill courier, with the note when there is one", () => {
    expect(DispatchService.toCourierBody("customer")).toEqual({
      courier_type: "customer",
      notes: null,
    });
    expect(DispatchService.toCourierBody("mill", "  Plate ABC 123  ")).toEqual({
      courier_type: "mill",
      notes: "Plate ABC 123",
    });
  });

  it("clears both the courier and the note", () => {
    expect(DispatchService.toCourierBody(null, "left over")).toEqual({
      courier_type: null,
      notes: null,
    });
  });
});
