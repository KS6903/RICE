import { describe, expect, it } from "vitest";
import { isVariablePay, monthlyForForm, monthlyFromRate, rateBasis } from "./employeePay";

// The same table as backend/tests/characterization/test_employee_numbers.py.
describe("monthlyFromRate", () => {
  it.each([
    ["daily", 500, 13000],
    ["regular", 500, 13000],
    ["casual", 500, 13000],
    ["monthly", 15000, 15000],
    ["biweekly", 7500, 15000],
    ["weekly", 3000, 13000],
    ["hourly", 70, 14560],
  ])("%s at %d comes to %d a month", (type, rate, monthly) => {
    expect(monthlyFromRate(type, rate)).toBe(monthly);
  });

  it("has no monthly figure for pay by output, or without a rate", () => {
    expect(monthlyFromRate("piece_rate", 40)).toBeNull();
    expect(monthlyFromRate("commission", 40)).toBeNull();
    expect(monthlyFromRate("daily", NaN)).toBeNull();
    expect(isVariablePay("piece_rate")).toBe(true);
    expect(isVariablePay("daily")).toBe(false);
  });

  it("rounds to centavos", () => {
    expect(monthlyFromRate("weekly", 1000)).toBe(4333.33);
  });
});

describe("rateBasis", () => {
  it("says what a rate is paid for", () => {
    expect(rateBasis("hourly")).toBe("per hour");
    expect(rateBasis("monthly")).toBe("per month");
    expect(rateBasis("regular")).toBe("per day");
  });
});

describe("monthlyForForm", () => {
  const base = { employment_type: "daily", daily_rate: "", monthly_salary: "" };

  it("works the figure out from the rate", () => {
    expect(monthlyForForm({ ...base, daily_rate: "500" }, false)).toBe("13000");
    expect(monthlyForForm({ ...base, employment_type: "commission", daily_rate: "9" }, false)).toBe(
      "",
    );
  });

  it("keeps a figure that was entered before rates drove it", () => {
    expect(monthlyForForm({ ...base, monthly_salary: "18000" }, false)).toBe("18000");
  });

  it("blanks the figure when the rate it came from is cleared", () => {
    expect(monthlyForForm({ ...base, monthly_salary: "13000" }, true)).toBe("");
  });
});
