import { QueryClient } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../stores/authStore";
import { createSessionQueryClient } from "./queryClient";
import { registerSessionQueryClient } from "./sessionCache";

const user = (id: string, companyId: string, fullName = id): User => ({
  id,
  company_id: companyId,
  username: id,
  full_name: fullName,
  role: "owner",
});

afterEach(() => {
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null });
  localStorage.clear();
});

describe("session query isolation", () => {
  it("clears cached tenant data before an account switch", () => {
    const client = new QueryClient();
    const unregister = registerSessionQueryClient(client);
    useAuthStore.setState({ user: user("a", "tenant-a") });
    client.setQueryData(["customers"], [{ id: "customer-a" }]);

    useAuthStore.getState().setUser(user("b", "tenant-b"));

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    unregister();
  });

  it("keeps cache for a cosmetic update in the same security context", () => {
    const client = new QueryClient();
    const unregister = registerSessionQueryClient(client);
    useAuthStore.setState({ user: user("a", "tenant-a", "Before") });
    client.setQueryData(["customers"], [{ id: "customer-a" }]);

    useAuthStore.getState().setUser(user("a", "tenant-a", "After"));

    expect(client.getQueryData(["customers"])).toEqual([{ id: "customer-a" }]);
    unregister();
  });

  it("hashes identical query keys into separate account scopes", () => {
    const client = createSessionQueryClient();
    useAuthStore.setState({ user: user("a", "tenant-a") });
    client.setQueryData(["invoices"], ["tenant-a-data"]);

    // Bypass the normal clearing action to prove the hash itself is isolated.
    useAuthStore.setState({ user: user("b", "tenant-b") });

    expect(client.getQueryData(["invoices"])).toBeUndefined();
  });
});
