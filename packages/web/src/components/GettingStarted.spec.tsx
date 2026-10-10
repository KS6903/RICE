import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import GettingStarted from "./GettingStarted";
import { useAuthStore } from "../stores/authStore";
import { gettingStartedService, type StepKey } from "../services/GettingStartedService";
import { useHelpStore } from "../stores/helpStore";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: ["*"],
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <GettingStarted />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** Stub the checks: the listed steps are done, the rest are not. */
const doneSteps = (...done: StepKey[]) =>
  vi.spyOn(gettingStartedService, "done").mockImplementation(async (s) => done.includes(s));

describe("GettingStarted", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: owner });
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists the mill's first steps in order, each linking to its form", async () => {
    doneSteps("paddy");
    draw();
    expect(await screen.findByText("Get your mill running")).toBeInTheDocument();
    expect(screen.getByText("1 of 5 done. Each step opens the form you need.")).toBeInTheDocument();
    // The next undone step leads; it opens the milling form directly.
    expect(screen.getByRole("link", { name: /Start a batch/ })).toHaveAttribute(
      "href",
      "/milling?new=1",
    );
    expect(screen.getByRole("link", { name: /Create an order/ })).toHaveAttribute(
      "href",
      "/sales?new=1",
    );
    // A done step has no link left.
    expect(screen.queryByRole("link", { name: /Record a purchase/ })).not.toBeInTheDocument();
  });

  it("shows nothing once every step is done", async () => {
    const spy = doneSteps("paddy", "milling", "sales", "expenses", "users");
    const { container } = draw();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("only offers the steps the user's role can take", async () => {
    useAuthStore.setState({ user: { ...owner, id: "u2", role: "cashier" } });
    const spy = doneSteps();
    draw();
    expect(await screen.findByRole("link", { name: /Create an order/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Record a purchase/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add a user/ })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith("users");
  });

  it("leaves out steps the plan doesn't include", async () => {
    useAuthStore.setState({ user: { ...owner, features: ["paddy", "milling", "sales"] } });
    doneSteps();
    draw();
    expect(
      await screen.findByText("0 of 3 done. Each step opens the form you need."),
    ).toBeInTheDocument();
  });

  it("offers the guided tour without starting it", async () => {
    doneSteps();
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Take the tour/ }));
    expect(useHelpStore.getState().touring).toBe(true);
    useHelpStore.setState({ touring: false });
  });

  it("stays hidden for that user once they hide it", async () => {
    doneSteps();
    const first = draw();
    fireEvent.click(await screen.findByRole("button", { name: /Hide/ }));
    expect(screen.queryByText("Get your mill running")).not.toBeInTheDocument();
    first.unmount();

    draw();
    // Give any (wrongly) running query a chance to render the card.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Get your mill running")).not.toBeInTheDocument();
  });
});
