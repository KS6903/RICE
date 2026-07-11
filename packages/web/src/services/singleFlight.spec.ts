import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "./singleFlight";

describe("createSingleFlight", () => {
  it("shares one refresh operation across concurrent callers", async () => {
    let release!: (value: string) => void;
    const task = vi.fn(
      () => new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const refresh = createSingleFlight(task);

    const first = refresh();
    const second = refresh();

    expect(first).toBe(second);
    expect(task).toHaveBeenCalledTimes(1);
    release("rotated");
    await expect(Promise.all([first, second])).resolves.toEqual(["rotated", "rotated"]);

    const later = refresh();
    release("rotated-again");
    await later;
    expect(task).toHaveBeenCalledTimes(2);
  });
});
