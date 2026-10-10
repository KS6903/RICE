import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
