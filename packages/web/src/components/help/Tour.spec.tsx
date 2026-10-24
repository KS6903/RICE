import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { accessLevel, type User } from "@rice-mill/shared";
import Tour from "./Tour";
import TourButton from "./TourButton";
import { tourStops } from "./tourStops";
import { useAuthStore } from "../../stores/authStore";
import { checklistHidden, setChecklistHidden, useHelpStore } from "../../stores/helpStore";

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: ["*"],
};

const titles = (user: User) =>
  tourStops(user, (section) => accessLevel(user.role, section) !== "none").map((s) => s.title);

describe("tourStops", () => {
  it("walks the owner through every page, from a welcome to the help button", () => {
    const t = titles(owner);
    expect(t[0]).toBe("Welcome to Oraiza");
    expect(t.slice(1, 6)).toEqual([
      "Dashboard",
      "Paddy / Palay",
      "Rice / Bigas",
      "By-products",
      "Milling",
    ]);
    expect(t).toContain("Users");
    expect(t.slice(-2)).toEqual(["Settings", "That's the tour"]);
  });

  it("skips pages the role can't open", () => {
    const t = titles({ ...owner, role: "cashier" });
    expect(t).toContain("Sales");
    expect(t).not.toContain("Paddy / Palay");
    expect(t).not.toContain("Expenses");
    expect(t).not.toContain("Users");
  });

  it("skips pages the plan doesn't include", () => {
    const t = titles({ ...owner, features: ["dashboard", "paddy", "milling", "sales"] });
    expect(t).toContain("Milling");
    expect(t).not.toContain("Automations");
    expect(t).not.toContain("Maintenance");
  });
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const draw = (start = "/costs") =>
  render(
    <MemoryRouter initialEntries={[start]}>
      <a data-tour="nav:/" href="/">
        Dashboard
      </a>
      <TourButton />
      <Where />
      <Tour />
    </MemoryRouter>,
  );

describe("Tour", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { ...owner, features: ["dashboard"] } });
  });
  afterEach(() => useHelpStore.setState({ touring: false }));

  it("never starts by itself", () => {
    draw();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens each page in turn and, at the end, returns to where it started", () => {
    draw("/costs");
    act(() => useHelpStore.getState().startTour());
    expect(screen.getByRole("dialog", { name: "Welcome to Oraiza" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
    expect(screen.getByRole("dialog", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);

    // Arrow keys work too, and Back goes back. (The Catalog and Reports come
    // with the dashboard on every plan; the Boss sees the Catalog.)
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Catalog" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/catalog");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Dashboard" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Reports" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "That's the tour" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/costs");
  });

  it("stops on Esc and leaves the user where they are", () => {
    draw("/costs");
    act(() => useHelpStore.getState().startTour());
    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useHelpStore.getState().touring).toBe(false);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });

  it("starts when the ? button is clicked", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(screen.getByRole("dialog", { name: "Welcome to Oraiza" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers a hidden checklist back at the end", () => {
    localStorage.clear();
    setChecklistHidden("u1", true);
    draw("/costs");
    act(() => useHelpStore.getState().startTour());
    for (let n = 0; n < 5; n++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "That's the tour" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Bring back the getting-started checklist" }),
    );
    expect(checklistHidden("u1")).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });
});
