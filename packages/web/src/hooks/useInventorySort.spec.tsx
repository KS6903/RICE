import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAuthStore } from "../stores/authStore";
import { useInventorySort } from "./useInventorySort";

const signIn = (id: string) => useAuthStore.setState({ user: { id } as any });

describe("useInventorySort", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn("owner-1");
  });

  it("starts on grade, then most stock", () => {
    const { result } = renderHook(() => useInventorySort());
    expect(result.current[0]).toBe("grade");
  });

  it("remembers the choice for the account, through a sign-out and a new visit", () => {
    const first = renderHook(() => useInventorySort());
    act(() => first.result.current[1]("least"));
    expect(first.result.current[0]).toBe("least");
    first.unmount();

    // Signed out, much later: another visit to the page still has it.
    useAuthStore.setState({ user: null });
    signIn("owner-1");
    const later = renderHook(() => useInventorySort());
    expect(later.result.current[0]).toBe("least");
  });

  it("keeps each account's choice separate on the same browser", () => {
    const owner = renderHook(() => useInventorySort());
    act(() => owner.result.current[1]("variety"));
    owner.unmount();

    signIn("cashier-1");
    const cashier = renderHook(() => useInventorySort());
    expect(cashier.result.current[0]).toBe("grade");
  });

  it("never hands one account's choice to another, even with the page left open", () => {
    const { result } = renderHook(() => useInventorySort());
    act(() => result.current[1]("least"));
    expect(localStorage.getItem("rice-mill-inventory-sort:owner-1")).toBe("least");

    act(() => signIn("cashier-1"));
    expect(result.current[0]).toBe("grade");
    expect(localStorage.getItem("rice-mill-inventory-sort:cashier-1")).toBeNull();

    act(() => result.current[1]("most"));
    expect(localStorage.getItem("rice-mill-inventory-sort:cashier-1")).toBe("most");
    expect(localStorage.getItem("rice-mill-inventory-sort:owner-1")).toBe("least");

    act(() => signIn("owner-1"));
    expect(result.current[0]).toBe("least");
  });

  it("ignores a saved value it does not recognise", () => {
    localStorage.setItem("rice-mill-inventory-sort:owner-1", "sideways");
    const { result } = renderHook(() => useInventorySort());
    expect(result.current[0]).toBe("grade");
  });
});
