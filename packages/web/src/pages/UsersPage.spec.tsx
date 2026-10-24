import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import UsersPage from "./UsersPage";
import { usersService } from "../services/UsersService";
import { roleAccessService, type RoleAccessData } from "../services/RoleAccessService";
import { useAuthStore } from "../stores/authStore";
import { chooseOption } from "../test/pickers";

configure({ asyncUtilTimeout: 5000 });

const boss: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
  features: ["*"],
};

const staff = [
  {
    id: "u1",
    username: "mill1",
    full_name: "Mill Boss",
    email: "boss@mill.test",
    role: { id: 1, name: "owner" },
    role_id: 1,
    is_active: true,
  },
  {
    id: "u2",
    username: "maria",
    full_name: "Maria Cruz",
    email: "maria@mill.test",
    role: { id: 5, name: "cashier" },
    role_id: 5,
    is_active: true,
  },
];

// The roles the Boss made up: one that runs the stock, one that runs the people.
const roleAccess: RoleAccessData = {
  sections: ["inventory", "users"],
  roles: [],
  custom_roles: [
    {
      id: "r1",
      name: "Warehouse Manager",
      access: { inventory: "full", users: "none" },
      people: 1,
    },
    { id: "r2", name: "Office Head", access: { inventory: "view", users: "full" }, people: 0 },
  ],
};

function setup(me: Partial<User> = {}, people: any[] = staff) {
  useAuthStore.setState({ user: { ...boss, ...me } });
  vi.spyOn(usersService, "list").mockResolvedValue(people);
  vi.spyOn(roleAccessService, "get").mockResolvedValue(roleAccess);
  const create = vi.spyOn(usersService, "create").mockResolvedValue({ id: "u9" });
  const update = vi.spyOn(usersService, "update").mockResolvedValue({ id: "u2" });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { create, update };
}

const openAddForm = () => fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
const createButton = () => screen.getByRole("button", { name: "Create User" });
const popup = () => screen.getByRole("dialog", { name: "Confirm it is you" });
const noPopup = () =>
  expect(screen.queryByRole("dialog", { name: "Confirm it is you" })).toBeNull();
const confirmWith = (password: string, code?: string) => {
  const dialog = within(popup());
  fireEvent.change(dialog.getByLabelText("Your password"), { target: { value: password } });
  if (code !== undefined) {
    fireEvent.change(dialog.getByLabelText("Authenticator code"), { target: { value: code } });
  }
  fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
};

describe("Add User: confirming a Boss or an Admin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("opens a popup as soon as Boss is chosen, and creates with what was typed", async () => {
    const { create } = setup();
    openAddForm();
    noPopup();
    // No role until one is chosen.
    expect(screen.getByLabelText("Role")).toHaveTextContent("-- Select Role --");
    expect(createButton()).toBeDisabled();

    await chooseOption("Role", "Boss");
    const dialog = within(popup());
    expect(popup()).toHaveTextContent("Making someone a Boss");
    // No two-factor set up, so no code is asked for.
    expect(dialog.queryByLabelText("Authenticator code")).toBeNull();
    const confirm = dialog.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();

    fireEvent.change(dialog.getByLabelText("Your password"), { target: { value: "hunter2" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    // Back in the form, with the role kept and the confirmation noted.
    noPopup();
    expect(screen.getByLabelText("Role")).toHaveTextContent("Boss");
    expect(screen.getByText("You confirmed it is you.")).toBeInTheDocument();

    fireEvent.click(createButton());
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ role_id: "1", current_password: "hunter2" }),
      ),
    );
    expect(create.mock.calls[0][0]).not.toHaveProperty("mfa_code");
  });

  it("keeps the browser and password managers from filling the password", async () => {
    setup();
    openAddForm();
    await chooseOption("Role", "Boss");
    const field = within(popup()).getByLabelText("Your password");
    expect(field).toHaveAttribute("autocomplete", "new-password");
    expect(field).toHaveAttribute("data-1p-ignore");
    expect(field).toHaveAttribute("data-lpignore", "true");
    expect(field).toHaveAttribute("data-bwignore", "true");
    expect(field).toHaveValue("");
  });

  it("asks the same for an Admin", async () => {
    setup();
    openAddForm();
    await chooseOption("Role", "Admin");
    expect(popup()).toHaveTextContent("Making someone an Admin");
  });

  it("asks for the authenticator code too when two-factor is on", async () => {
    const { create } = setup({ mfa_enabled: true });
    openAddForm();
    await chooseOption("Role", "Boss");
    const dialog = within(popup());
    const confirm = dialog.getByRole("button", { name: "Confirm" });

    fireEvent.change(dialog.getByLabelText("Your password"), { target: { value: "hunter2" } });
    expect(confirm).toBeDisabled();

    // Only digits go in, six of them.
    const code = dialog.getByLabelText("Authenticator code");
    fireEvent.change(code, { target: { value: "12ab34" } });
    expect(code).toHaveValue("1234");
    expect(confirm).toBeDisabled();

    fireEvent.change(code, { target: { value: "123456" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    fireEvent.click(createButton());
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ role_id: "1", current_password: "hunter2", mfa_code: "123456" }),
      ),
    );
  });

  it("asks for nothing for the other roles", async () => {
    const { create } = setup({ mfa_enabled: true });
    openAddForm();
    await chooseOption("Role", "Cashier");
    noPopup();
    expect(createButton()).toBeEnabled();

    fireEvent.click(createButton());
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).not.toHaveProperty("current_password");

    // The form closes, and the next person starts with no role chosen.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Create User" })).toBeNull());
    openAddForm();
    expect(screen.getByLabelText("Role")).toHaveTextContent("-- Select Role --");
  });

  it("lists -- Select Role -- as the first choice, and picking it clears the role", async () => {
    const { create } = setup();
    openAddForm();
    fireEvent.click(screen.getByLabelText("Role"));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names[0]).toBe("-- Select Role --");
    expect(names).toContain("Cashier");
    fireEvent.click(screen.getByRole("option", { name: "Cashier" }));
    expect(createButton()).toBeEnabled();

    await chooseOption("Role", "-- Select Role --");
    noPopup();
    expect(screen.getByLabelText("Role")).toHaveTextContent("-- Select Role --");
    expect(createButton()).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it("goes back to -- Select Role -- when the popup is cancelled", async () => {
    const { create } = setup();
    openAddForm();
    await chooseOption("Role", "Boss");
    fireEvent.change(within(popup()).getByLabelText("Your password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(within(popup()).getByRole("button", { name: "Cancel" }));

    noPopup();
    expect(screen.getByLabelText("Role")).toHaveTextContent("-- Select Role --");
    expect(createButton()).toBeDisabled();
    expect(create).not.toHaveBeenCalled();

    // Choosing again starts over, with nothing typed.
    await chooseOption("Role", "Admin");
    expect(within(popup()).getByLabelText("Your password")).toHaveValue("");
  });

  it("treats Escape and a press on the backdrop as cancelling", async () => {
    setup();
    openAddForm();
    await chooseOption("Role", "Boss");
    fireEvent.keyDown(window, { key: "Escape" });
    noPopup();
    expect(screen.getByLabelText("Role")).toHaveTextContent("-- Select Role --");

    await chooseOption("Role", "Admin");
    fireEvent.mouseDown(popup().parentElement as Element);
    noPopup();
    expect(screen.getByLabelText("Role")).toHaveTextContent("-- Select Role --");
  });

  it("asks again, with the reason, when the server turns the confirmation down", async () => {
    const { create } = setup({ mfa_enabled: true });
    create.mockRejectedValueOnce({
      response: { data: { detail: "Invalid authentication code.", code: "confirm_failed" } },
    });
    openAddForm();
    await chooseOption("Role", "Boss");
    confirmWith("hunter2", "123456");
    fireEvent.click(createButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid authentication code.");
    // It opens empty: a code works once.
    expect(within(popup()).getByLabelText("Your password")).toHaveValue("");
    expect(within(popup()).getByLabelText("Authenticator code")).toHaveValue("");

    confirmWith("hunter2", "654321");
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ mfa_code: "654321" })),
    );
  });

  it("shows other refusals in the form, not in the popup", async () => {
    const { create } = setup();
    create.mockRejectedValueOnce({ response: { data: { detail: "Username already exists" } } });
    openAddForm();
    await chooseOption("Role", "Boss");
    confirmWith("hunter2");
    fireEvent.click(createButton());

    expect(await screen.findByText("Username already exists")).toBeInTheDocument();
    noPopup();
  });
});

describe("Edit User: promoting someone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  const openEdit = async () => {
    fireEvent.click(await screen.findByTitle("Edit maria"));
  };

  it("asks you to confirm when the new role is Boss or Admin", async () => {
    const { update } = setup({ mfa_enabled: true });
    await openEdit();
    noPopup();
    expect(screen.getByLabelText("Role")).toHaveTextContent("Cashier");

    await chooseOption("Role", "Admin");
    expect(popup()).toHaveTextContent("Making someone an Admin");
    confirmWith("hunter2", "654321");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        "u2",
        expect.objectContaining({ role_id: 2, current_password: "hunter2", mfa_code: "654321" }),
      ),
    );
  });

  it("puts back the role the person has when the popup is cancelled", async () => {
    setup();
    await openEdit();
    await chooseOption("Role", "Boss");
    fireEvent.click(within(popup()).getByRole("button", { name: "Cancel" }));

    noPopup();
    expect(screen.getByLabelText("Role")).toHaveTextContent("Cashier");
  });

  it("asks nothing when the role is left as it is, or moved to another one", async () => {
    const { update } = setup();
    await openEdit();
    // The edit form opens on the person's own role, whatever it is.
    noPopup();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

    await chooseOption("Role", "Accountant");
    noPopup();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).not.toHaveProperty("current_password");
  });
});

describe("Users page: who can open what", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("is for the Boss to see", () => {
    setup();
    expect(screen.getByRole("button", { name: /Who can open what/ })).toBeInTheDocument();
  });

  it("is not shown to an Admin, who can manage people but not what roles can open", () => {
    setup({ role: "admin" });
    expect(screen.queryByRole("button", { name: /Who can open what/ })).toBeNull();
  });
});

describe("Users: seats on the plan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  const plan = (max_users: number | null) => ({
    subscription: {
      code: "basic",
      name: "Basic",
      monthly_price: 999,
      max_users,
      max_branches: 1,
      status: "active",
      expires_at: null,
    },
  });

  it("counts the active users, the Boss included, against the plan", async () => {
    setup(plan(5));
    expect(await screen.findByText("2 of 5 users")).toBeInTheDocument();
  });

  it("says when every seat is taken", async () => {
    setup(plan(2));
    expect(
      await screen.findByText("2 of 2 users. Every seat is taken: upgrade your plan to add more."),
    ).toBeInTheDocument();
  });

  it("says when the plan has no limit", async () => {
    setup(plan(null));
    expect(await screen.findByText("2 users. Your plan has no user limit.")).toBeInTheDocument();
  });
});

describe("Roles the Boss made up", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("offers them beside the built-in roles, and creates with the one picked", async () => {
    const { create } = setup();
    openAddForm();
    await chooseOption("Role", "Warehouse Manager");
    // It can't manage the people, so nothing to confirm.
    noPopup();
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ role_id: "c:r1" })),
    );
  });

  it("asks you to confirm a role that can manage the people", async () => {
    setup();
    openAddForm();
    await chooseOption("Role", "Office Head");
    expect(popup()).toHaveTextContent("Office Head");
  });

  it("names someone's made-up role in the list", async () => {
    setup({}, [
      ...staff,
      {
        id: "u3",
        username: "keeper",
        full_name: "Stock Keeper",
        role: null,
        role_id: null,
        custom_role_id: "r1",
        custom_role: { id: "r1", name: "Warehouse Manager" },
        is_active: true,
      },
    ]);
    const row = (await screen.findByText("Stock Keeper")).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Warehouse Manager");
  });
});
