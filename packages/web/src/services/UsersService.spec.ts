import { describe, expect, it } from "vitest";
import { UsersService, roleField } from "./UsersService";

describe("the role a new user is given", () => {
  it("sends a built-in role as its number", () => {
    expect(roleField("5")).toEqual({ role_id: 5 });
  });

  it("sends a role the Boss made up under custom_role_id", () => {
    expect(roleField("c:9b2f")).toEqual({ custom_role_id: "9b2f" });
  });

  it("builds the create payload with one or the other", () => {
    const form = { username: "a", full_name: "A", email: "", password: "secret123" };
    expect(UsersService.toCreatePayload({ ...form, role_id: "3" })).toEqual({
      ...form,
      role_id: 3,
    });
    expect(UsersService.toCreatePayload({ ...form, role_id: "c:r1" })).toEqual({
      ...form,
      custom_role_id: "r1",
    });
  });
});
