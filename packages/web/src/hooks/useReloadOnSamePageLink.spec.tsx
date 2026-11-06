import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import useReloadOnSamePageLink from "./useReloadOnSamePageLink";
import { useHelpStore } from "../stores/helpStore";

// Only the sign-out in progress matters here; the store itself is not needed.
const pendingLogout = vi.hoisted(() => vi.fn<() => Promise<void> | null>(() => null));
vi.mock("../stores/authStore", () => ({ pendingLogout }));

let go: (to: string, options?: { replace?: boolean }) => void;
function Nav() {
  go = useNavigate();
  return null;
}
function Reloader() {
  useReloadOnSamePageLink();
  return null;
}

// Plain links: the handler listens on the document, whatever draws the link. The
// ones that must not reload stop the click themselves so jsdom does not "navigate".
const stay = (e: React.MouseEvent) => e.preventDefault();

function draw() {
  render(
    <MemoryRouter initialEntries={["/sales"]}>
      <Nav />
      <Reloader />
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

describe("useReloadOnSamePageLink", () => {
  const reload = vi.fn();
  const original = window.location;

  beforeEach(() => {
    reload.mockClear();
    pendingLogout.mockReset();
    pendingLogout.mockReturnValue(null);
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
  });

  it("changes pages in place, so a page visited before draws from its cached data", () => {
    draw();
    act(() => go("/purchases"));
    act(() => go("/sales"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when a link to the page already open is clicked", () => {
    draw();
    const notHandledByBrowser = fireEvent.click(screen.getByText("This page"));
    expect(reload).toHaveBeenCalledTimes(1);
    // The click is taken over, so the router does not also "navigate" to where it is.
    expect(notHandledByBrowser).toBe(false);
  });

  it("waits for a sign-out in progress before it reloads", async () => {
    let finish!: () => void;
    pendingLogout.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    draw();
    fireEvent.click(screen.getByText("This page"));
    expect(reload).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(reload).toHaveBeenCalledTimes(1);
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

  it("leaves a click on the page's own link alone while the guided tour runs", () => {
    useHelpStore.setState({ touring: true });
    draw();
    const link = screen.getByText("This page");
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(reload).not.toHaveBeenCalled();
  });
});
