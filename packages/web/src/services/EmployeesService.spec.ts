import { describe, expect, it } from "vitest";
import { EmployeesService } from "./EmployeesService";

describe("EmployeesService.toUpdatePayload", () => {
  it("sends blank optional fields as null, so the server clears them", () => {
    const payload = EmployeesService.toUpdatePayload({
      first_name: "Rosa",
      last_name: "Diaz",
      email: "",
      daily_rate: "",
      date_terminated: "",
      position: "Foreman",
      monthly_salary: "15000",
    });
    expect(payload).toMatchObject({
      first_name: "Rosa",
      last_name: "Diaz",
      email: null,
      daily_rate: null,
      date_terminated: null,
      position: "Foreman",
      monthly_salary: 15000,
    });
  });

  it("leaves a blank name blank, for the server to refuse", () => {
    expect(EmployeesService.toUpdatePayload({ first_name: "", last_name: "" })).toMatchObject({
      first_name: "",
      last_name: "",
    });
  });
});
