import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAfterDelay } from "./useAfterDelay";

describe("useAfterDelay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns true only once the wait has lasted the whole delay", () => {
    const { result } = renderHook(() => useAfterDelay(true, 3000));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it("turns false as soon as the wait ends, and starts over the next time", () => {
    const { result, rerender } = renderHook(({ active }) => useAfterDelay(active, 3000), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);

    rerender({ active: true });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(true);
  });
});
