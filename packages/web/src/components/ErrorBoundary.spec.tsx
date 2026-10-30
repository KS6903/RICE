import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";

function Broken({ message }: { message: string }): never {
  throw new Error(message);
}

describe("ErrorBoundary", () => {
  const reload = vi.fn();
  const original = window.location;

  beforeEach(() => {
    reload.mockClear();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    // React logs every error it hands to a boundary.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
  });

  it("draws its children while nothing fails", () => {
    render(
      <ErrorBoundary>
        <p>Fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Fine")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows a message and a button that reloads, not a blank window", async () => {
    render(
      <ErrorBoundary>
        <Broken message="boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("loads the current build when a page's file is gone after a deploy", () => {
    render(
      <ErrorBoundary>
        <Broken message="Failed to fetch dynamically imported module: /assets/LoginPage-abc123.js" />
      </ErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    // A spinner until the reload lands, not the error message.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not reload in a loop when the file really is missing", () => {
    sessionStorage.setItem("stale-build-reload-at", String(Date.now()));
    render(
      <ErrorBoundary>
        <Broken message="Importing a module script failed." />
      </ErrorBoundary>,
    );
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not reload the desktop app, whose files ship with it", () => {
    (window as any).electronAPI = { isElectron: true };
    render(
      <ErrorBoundary>
        <Broken message="error loading dynamically imported module" />
      </ErrorBoundary>,
    );
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
