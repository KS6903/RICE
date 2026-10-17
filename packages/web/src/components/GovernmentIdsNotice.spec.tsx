import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import GovernmentIdsNotice from "./GovernmentIdsNotice";
import { useAuthStore } from "../stores/authStore";
import { automationsService, type Automation } from "../services/AutomationsService";

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const complete = {
  sss_no: "34-1",
  philhealth_no: "12-1",
  pagibig_no: "1212",
  tin: "123-456",
};

const employees = [
  { id: "e1", full_name: "Juan Cruz", is_active: true, ...complete, tin: "" },
  { id: "e2", full_name: "Ana Reyes", is_active: true, ...complete },
  { id: "e3", full_name: "Old Hand", is_active: false },
  { id: "e4", full_name: "Pedro Santos", is_active: true, sss_no: null },
];

const reminder: Automation = {
  code: "government_ids",
  title: "Missing government numbers",
  description: "",
  group: "people",
  fields: [],
  params: { email: true },
  enabled: false,
  recipients: [],
  effective_recipients: [],
  default_roles: ["owner"],
  candidates: [],
  last_run: null,
};

const draw = (onOpen = vi.fn()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <GovernmentIdsNotice employees={employees} onOpen={onOpen} />
    </QueryClientProvider>,
  );

describe("GovernmentIdsNotice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
    // The minimized choice is kept in the browser: don't let one test's carry over.
    localStorage.clear();
  });

  it("names the active employees missing numbers, and opens one when clicked", () => {
    useAuthStore.setState({ user: { ...owner, features: ["employees"] } });
    const onOpen = vi.fn();
    draw(onOpen);
    const box = screen.getByRole("region", { name: "Missing government numbers" });
    expect(box).toHaveTextContent("2 active employees are missing government numbers.");
    fireEvent.click(within(box).getByRole("button", { name: "Show who" }));
    expect(box).toHaveTextContent("Juan Cruz: no TIN");
    expect(box).toHaveTextContent("Pedro Santos: no SSS, PhilHealth, Pag-IBIG, TIN");
    expect(box).not.toHaveTextContent("Old Hand");
    fireEvent.click(within(box).getByRole("button", { name: "Juan Cruz" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
    // No reminder without the automations feature.
    expect(within(box).queryByRole("checkbox")).toBeNull();
  });

  it("switches the monthly reminder on for an Enterprise owner", async () => {
    useAuthStore.setState({ user: { ...owner, features: ["employees", "automations"] } });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [reminder] });
    const update = vi
      .spyOn(automationsService, "update")
      .mockResolvedValue({ ...reminder, enabled: true });
    draw();
    const box = screen.getByRole("region", { name: "Missing government numbers" });
    fireEvent.click(
      await within(box).findByRole("checkbox", { name: /Remind me on the 1st of each month/ }),
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("government_ids", {
        enabled: true,
        params: { email: true },
        recipients: [],
      }),
    );
  });

  it("minimizes to one slim row that still says how many, and expands again", () => {
    useAuthStore.setState({ user: { ...owner, features: ["employees"] } });
    draw();
    const box = screen.getByRole("region", { name: "Missing government numbers" });
    expect(box).toHaveTextContent("You need SSS, PhilHealth, Pag-IBIG and TIN numbers");

    // An icon, no word: the name is only for screen readers and the tooltip.
    const minimize = within(box).getByRole("button", { name: "Minimize" });
    expect(minimize.textContent).toBe("");
    fireEvent.click(minimize);
    expect(box).toHaveTextContent("2 active employees are missing government numbers.");
    expect(box).not.toHaveTextContent("You need SSS");
    expect(within(box).queryByRole("button", { name: /Show who|Hide who/ })).toBeNull();
    expect(within(box).queryByRole("button", { name: "Minimize" })).toBeNull();

    const expand = within(box).getByRole("button", { name: "Expand" });
    expect(expand.textContent).toBe("");
    fireEvent.click(expand);
    expect(box).toHaveTextContent("You need SSS, PhilHealth, Pag-IBIG and TIN numbers");
    expect(within(box).getByRole("button", { name: "Show who" })).toBeInTheDocument();
  });

  it("puts the list and the monthly reminder away with the rest when minimized", async () => {
    useAuthStore.setState({ user: { ...owner, features: ["employees", "automations"] } });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [reminder] });
    draw();
    const box = screen.getByRole("region", { name: "Missing government numbers" });
    fireEvent.click(within(box).getByRole("button", { name: "Show who" }));
    expect(box).toHaveTextContent("Juan Cruz: no TIN");
    expect(await within(box).findByRole("checkbox")).toBeInTheDocument();

    fireEvent.click(within(box).getByRole("button", { name: "Minimize" }));
    expect(box).not.toHaveTextContent("Juan Cruz");
    expect(within(box).queryByRole("checkbox")).toBeNull();
  });

  it("stays minimized on the next visit, for that account only", () => {
    useAuthStore.setState({ user: { ...owner, features: ["employees"] } });
    const first = draw();
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    first.unmount();

    // The same account, back on the page: still put away.
    draw();
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
    cleanup();

    // Someone else signing in on this browser sees it open.
    useAuthStore.setState({ user: { ...owner, id: "u2", features: ["employees"] } });
    draw();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
  });

  it("says nothing when everyone's numbers are on file", () => {
    useAuthStore.setState({ user: { ...owner, features: ["employees"] } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GovernmentIdsNotice
          employees={[{ id: "e2", full_name: "Ana Reyes", is_active: true, ...complete }]}
          onOpen={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("region", { name: "Missing government numbers" })).toBeNull();
  });
});
