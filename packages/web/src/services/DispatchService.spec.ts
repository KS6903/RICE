import { describe, expect, it } from "vitest";
import { DispatchService } from "./DispatchService";

describe("DispatchService.toCourierBody", () => {
  it("names the courier with the vehicle and the driver, blanks as null", () => {
    expect(
      DispatchService.toCourierBody("customer", { plate_number: "XYZ 987", driver_name: "Ana" }),
    ).toEqual({
      courier_type: "customer",
      plate_number: "XYZ 987",
      driver_name: "Ana",
      driver_phone: null,
      notes: null,
    });
    expect(
      DispatchService.toCourierBody("mill", {
        plate_number: "  ABC 1234  ",
        driver_name: " Juan ",
        driver_phone: "0917 123 4567",
        notes: "  Leaves at 6am  ",
      }),
    ).toEqual({
      courier_type: "mill",
      plate_number: "ABC 1234",
      driver_name: "Juan",
      driver_phone: "0917 123 4567",
      notes: "Leaves at 6am",
    });
  });

  it("clears the courier and everything with it", () => {
    expect(
      DispatchService.toCourierBody(null, {
        plate_number: "ABC 1234",
        driver_name: "Juan",
        notes: "left over",
      }),
    ).toEqual({
      courier_type: null,
      plate_number: null,
      driver_name: null,
      driver_phone: null,
      notes: null,
    });
  });
});
