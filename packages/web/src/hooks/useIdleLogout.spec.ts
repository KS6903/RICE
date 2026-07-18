import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIdleLogout, IDLE_TIMEOUT_MS } from "./useIdleLogout";
import { useAuthStore } from "../stores/authStore";

// useNavigate is the only router dependency; mock it so the hook needs no Router.
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

describe("useIdleLogout", () => {
  let logout: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    navigate.mockClear();
    logout = vi.fn().mockResolvedValue(undefined);
    // Authenticated, with logout stubbed so no real server/desktop calls fire.
    useAuthStore.setState({ user: { id: 1 } as any, accessToken: null, logout } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ user: null, accessToken: null } as any);
  });

  it("does nothing before the idle window elapses", () => {
    renderHook(() => useIdleLogout());
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000);
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("signs out and routes to /login after the idle window", () => {
    renderHook(() => useIdleLogout());
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login?reason=idle", { replace: true });
  });

  it("resets the countdown on user activity", () => {
    renderHook(() => useIdleLogout());
    // Activity just before expiry should buy a fresh full window.
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000);
    window.dispatchEvent(new Event("mousemove"));
    vi.advanceTimersByTime(2000); // past the ORIGINAL deadline — must not fire
    expect(logout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS); // now idle long enough again
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does not arm while logged out", () => {
    useAuthStore.setState({ user: null, accessToken: null, logout } as any);
    renderHook(() => useIdleLogout());
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
