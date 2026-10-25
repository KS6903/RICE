import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import ReloadOnPageChange from "./ReloadOnPageChange";

let go: (to: string) => void;
function Nav() {
  go = useNavigate();
  return null;
}

function draw() {
  render(
    <MemoryRouter initialEntries={["/sales"]}>
      <Nav />
      <ReloadOnPageChange />
    </MemoryRouter>,
  );
}

describe("ReloadOnPageChange", () => {
  const reload = vi.fn();
  const original = window.location;

  beforeEach(() => {
    reload.mockClear();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
    delete (window as any).electronAPI;
    vi.useRealTimers();
  });

  it("does not reload for the page the app opened on", () => {
    draw();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when the person goes to another page", () => {
    draw();
    act(() => go("/purchases"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a query change on the same page alone", () => {
    draw();
    act(() => go("/sales?tab=unpaid"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload again for a redirect right after a reload", () => {
    draw();
    act(() => go("/purchases"));
    act(() => go("/purchases/new"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("moves in place in the desktop app, which would be signed out by a reload", () => {
    (window as any).electronAPI = { isElectron: true };
    draw();
    act(() => go("/purchases"));
    expect(reload).not.toHaveBeenCalled();
  });
});
