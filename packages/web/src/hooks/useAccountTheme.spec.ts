import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAccountTheme } from "./useAccountTheme";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";

const isDark = () => document.documentElement.classList.contains("dark");

describe("useAccountTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.getState().leave();
    // mill1 chose dark mode on an earlier visit.
    localStorage.setItem("rice-mill-theme:mill1-id", "dark");
    useAuthStore.setState({ user: { id: "mill1-id" } as any });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null });
  });

  it("puts the signed-in account's theme on screen inside the app", () => {
    renderHook(() => useAccountTheme());
    expect(isDark()).toBe(true);
  });

  it("goes back to light on leaving the app", () => {
    const { unmount } = renderHook(() => useAccountTheme());
    unmount();
    expect(isDark()).toBe(false);
  });

  it("goes back to light on signing out", () => {
    renderHook(() => useAccountTheme());
    act(() => useAuthStore.setState({ user: null }));
    expect(isDark()).toBe(false);
    expect(useThemeStore.getState().theme).toBe("light");
  });
});
