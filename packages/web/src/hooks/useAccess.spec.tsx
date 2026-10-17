import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { User } from "@rice-mill/shared";
import { useAccess } from "./useAccess";
import { useAuthStore } from "../stores/authStore";

const cashier: User = {
  id: "u1",
  username: "tess",
  full_name: "Tess",
  role: "cashier",
  company_id: "c1",
};

const as = (user: Partial<User>) => {
  useAuthStore.setState({ user: { ...cashier, ...user } });
  return renderHook(() => useAccess()).result.current;
};

describe("useAccess", () => {
  afterEach(() => useAuthStore.setState({ user: null }));

  it("falls back to the shared role matrix when the server sends no access", () => {
    const access = as({});
    expect(access.canView("reports")).toBe(false);
    expect(access.canEdit("sales")).toBe(true);
    expect(access.isReadOnly("inventory")).toBe(true);
  });

  it("follows what the server says, which carries the Boss's changes", () => {
    const access = as({ access: { reports: "view", sales: "none", inventory: "full" } });
    // Opened to the role, read-only.
    expect(access.canView("reports")).toBe(true);
    expect(access.canEdit("reports")).toBe(false);
    expect(access.isReadOnly("reports")).toBe(true);
    // Closed to it, though the default had it open.
    expect(access.canView("sales")).toBe(false);
    // Given more than the default.
    expect(access.canEdit("inventory")).toBe(true);
  });

  it("uses the shared matrix for a page the server didn't mention", () => {
    const access = as({ access: { reports: "view" } });
    expect(access.canEdit("sales")).toBe(true);
    expect(access.canView("paddy")).toBe(false);
  });

  it("ignores a level it doesn't know rather than opening the page", () => {
    const access = as({ access: { reports: "superuser" as never } });
    expect(access.canView("reports")).toBe(false);
  });

  it("gives a platform admin everything whatever it is told", () => {
    const access = as({ is_platform_admin: true, role: null, access: { reports: "none" } });
    expect(access.canEdit("reports")).toBe(true);
  });
});
