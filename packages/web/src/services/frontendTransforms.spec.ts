import { describe, it, expect } from "vitest";
import { UsersService } from "./UsersService";
import { CostsService } from "./CostsService";

describe("UsersService.toCreatePayload", () => {
  it("coerces role_id from string to int", () => {
    const out = UsersService.toCreatePayload({
      username: "u",
      full_name: "U",
      email: "",
      password: "secret123",
      role_id: "3",
    });
    // A built-in role goes as its number (a made-up one under custom_role_id).
    expect(out).toMatchObject({ role_id: 3, username: "u" });
  });
});

describe("CostsService.toExpensePayload", () => {
  it("parses amount and nulls an empty batch link", () => {
    expect(
      CostsService.toExpensePayload({
        category_id: "c1",
        batch_id: "",
        expense_date: "2026-06-08",
        amount: "1500.50",
        description: "",
        reference_no: "",
      }),
    ).toMatchObject({ category_id: "c1", batch_id: null, amount: 1500.5 });
  });

  it("keeps a provided batch link", () => {
    const out = CostsService.toExpensePayload({
      category_id: "c1",
      batch_id: "b1",
      expense_date: "2026-06-08",
      amount: "10",
      description: "",
      reference_no: "",
    });
    expect(out.batch_id).toBe("b1");
    expect(out.amount).toBe(10);
  });
});
