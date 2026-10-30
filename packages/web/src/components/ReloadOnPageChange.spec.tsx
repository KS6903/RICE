import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import ReloadOnPageChange from "./ReloadOnPageChange";
import { useHelpStore } from "../stores/helpStore";

// Only the sign-out in progress matters here; the store itself is not needed.
const pendingLogout = vi.hoisted(() => vi.fn<() => Promise<void> | null>(() => null));
vi.mock("../stores/authStore", () => ({ pendingLogout }));

let go: (to: string) => void;
function Nav() {
  go = useNavigate();
  return null;
}

// Plain links: the handler listens on the document, whatever draws the link. The
// ones that must not reload stop the click themselves so jsdom does not "navigate".
const stay = (e: React.MouseEvent) => e.preventDefault();

function draw() {
  render(
    <MemoryRouter initialEntries={["/sales"]}>
      <Nav />
      <ReloadOnPageChange />
      <a href="/sales">This page</a>
      <a href="/sales?tab=unpaid" onClick={stay}>
        Other tab
      </a>
      <a href="/purchases" onClick={stay}>
        Another page
      </a>
      <a href="/sales#totals" onClick={stay}>
        Jump
      </a>
      <a href="/sales" target="_blank" onClick={stay}>
        New tab
      </a>
    </MemoryRouter>,
  );
}

describe("ReloadOnPageChange", () => {
  const reload = vi.fn();
  const original = window.location;

  beforeEach(() => {
    reload.mockClear();
    pendingLogout.mockReset();
    pendingLogout.mockReturnValue(null);
    sessionStorage.clear();
    // The page open is /sales, as in the router.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, origin: original.origin, pathname: "/sales", search: "", reload },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
    delete (window as any).electronAPI;
    useHelpStore.setState({ touring: false });
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

  it("waits for a sign-out in progress before it reloads", async () => {
    let finish!: () => void;
    pendingLogout.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    draw();
    act(() => go("/purchases"));
    expect(reload).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when a link to the page already open is clicked", () => {
    draw();
    const notHandledByBrowser = fireEvent.click(screen.getByText("This page"));
    expect(reload).toHaveBeenCalledTimes(1);
    // The click is taken over, so the router does not also "navigate" to where it is.
    expect(notHandledByBrowser).toBe(false);
  });

  it("leaves a link to anywhere else to do its own thing", () => {
    draw();
    fireEvent.click(screen.getByText("Other tab"));
    fireEvent.click(screen.getByText("Another page"));
    fireEvent.click(screen.getByText("Jump"));
    fireEvent.click(screen.getByText("New tab"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves a click with a modifier key alone (open in a new tab)", () => {
    draw();
    const link = screen.getByText("This page");
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { shiftKey: true });
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload on a link click in the desktop app", () => {
    (window as any).electronAPI = { isElectron: true };
    draw();
    const link = screen.getByText("This page");
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(reload).not.toHaveBeenCalled();
  });

  it("changes pages in place while the guided tour runs, which keeps its place in memory", () => {
    useHelpStore.setState({ touring: true });
    draw();
    act(() => go("/purchases"));
    expect(reload).not.toHaveBeenCalled();
    // Done: the tour stops, then takes the person back to where they started.
    useHelpStore.setState({ touring: false });
    act(() => go("/costs"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a click on the page's own link alone while the guided tour runs", () => {
    useHelpStore.setState({ touring: true });
    draw();
    const link = screen.getByText("This page");
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(reload).not.toHaveBeenCalled();
  });
});
