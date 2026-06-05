// Characterization of the shared RBAC matrix (packages/shared/constants/access).
// Pins who-can-see-what so the frontend RBAC refactor (Phase F) can't drift it.
import { describe, it, expect } from "vitest";
import { accessLevel, canView, canEdit } from "@rice-mill/shared";

describe("RBAC access helpers", () => {
  it("treats an empty/unknown role as no access", () => {
    expect(accessLevel(null, "paddy")).toBe("none");
    expect(accessLevel(undefined, "sales")).toBe("none");
    expect(canView(null, "dashboard")).toBe(false);
  });

  it("gives management full access everywhere", () => {
    expect(canEdit("owner", "users")).toBe(true);
    expect(canEdit("admin", "reports")).toBe(true);
  });

  it("makes accountant read-only on operations but full on books", () => {
    expect(canView("accountant", "paddy")).toBe(true);
    expect(canEdit("accountant", "paddy")).toBe(false);
    expect(canEdit("accountant", "expenses")).toBe(true);
    expect(canView("accountant", "users")).toBe(false);
  });

  it("hides operations from cashier", () => {
    expect(canView("cashier", "paddy")).toBe(false);
    expect(canView("cashier", "milling")).toBe(false);
    expect(canEdit("cashier", "sales")).toBe(true);
  });

  it("keeps mill_operator off the sales/back-office sections", () => {
    expect(canView("mill_operator", "sales")).toBe(false);
    expect(canEdit("mill_operator", "milling")).toBe(true);
  });
});
