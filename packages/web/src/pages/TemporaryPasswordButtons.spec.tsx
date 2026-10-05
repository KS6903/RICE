import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import UsersPage from "./UsersPage";
import AdminUsers from "./admin/AdminUsers";
import { usersService } from "../services/UsersService";
import { adminService } from "../services/AdminService";
import { useAuthStore } from "../stores/authStore";

const boss: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
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
    role: { id: 4, name: "cashier" },
    role_id: 4,
    is_active: true,
  },
  {
    id: "u3",
    username: "pedro",
    full_name: "Pedro Reyes",
    email: null,
    role: { id: 4, name: "cashier" },
    role_id: 4,
    is_active: false,
  },
];

const given = {
  username: "maria",
  temporary_password: "Temp-Pass-0000",
  expires_at: "2026-10-05T06:00:00Z",
};

const draw = (page: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

describe("Users page: the Boss gives a locked-out employee a temporary password", () => {
  it("offers it for other active staff, not for the Boss's own row or a removed user", async () => {
    useAuthStore.setState({ user: boss });
    vi.spyOn(usersService, "list").mockResolvedValue(staff);
    draw(<UsersPage />);
    expect(
      await screen.findByRole("button", { name: "Give maria a temporary password" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give mill1 a temporary password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Give pedro a temporary password" })).toBeNull();
  });

  it("is only for the Boss: an admin sees no such button", async () => {
    useAuthStore.setState({ user: { ...boss, id: "u9", role: "admin" } });
    vi.spyOn(usersService, "list").mockResolvedValue(staff);
    draw(<UsersPage />);
    await screen.findByText("Maria Cruz");
    expect(screen.queryByRole("button", { name: /temporary password/ })).toBeNull();
  });

  it("asks first, then gives the password for that person and shows it once", async () => {
    useAuthStore.setState({ user: boss });
    vi.spyOn(usersService, "list").mockResolvedValue(staff);
    const issue = vi.spyOn(usersService, "issueTemporaryPassword").mockResolvedValue(given);
    draw(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Give maria a temporary password" }));
    expect(issue).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: /Give Maria Cruz a temporary password/ }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Give temporary password" }));
    expect(await screen.findByLabelText("Temporary password")).toHaveTextContent("Temp-Pass-0000");
    expect(issue).toHaveBeenCalledWith("u2");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Temp-Pass-0000")).toBeNull(); // gone once closed
  });
});

describe("Admin users: the platform admin gives a locked-out Boss a temporary password", () => {
  const everyone = [
    { ...staff[0], role: "owner", company_id: "c1", company_name: "Mill One", last_login: null },
    { ...staff[2], role: "cashier", company_id: "c1", company_name: "Mill One", last_login: null },
  ];

  it("offers it for active users only", async () => {
    useAuthStore.setState({ user: { ...boss, id: "admin", is_platform_admin: true } });
    vi.spyOn(adminService, "listAllUsers").mockResolvedValue(everyone);
    draw(<AdminUsers />);
    expect(
      await screen.findByRole("button", { name: "Give mill1 a temporary password" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give pedro a temporary password" })).toBeNull();
  });

  it("gives it through the admin endpoint", async () => {
    useAuthStore.setState({ user: { ...boss, id: "admin", is_platform_admin: true } });
    vi.spyOn(adminService, "listAllUsers").mockResolvedValue(everyone);
    const issue = vi
      .spyOn(adminService, "issueTemporaryPassword")
      .mockResolvedValue({ ...given, username: "mill1" });
    draw(<AdminUsers />);
    fireEvent.click(await screen.findByRole("button", { name: "Give mill1 a temporary password" }));
    fireEvent.click(screen.getByRole("button", { name: "Give temporary password" }));
    await waitFor(() => expect(issue).toHaveBeenCalledWith("u1"));
    expect(await screen.findByLabelText("Temporary password")).toBeInTheDocument();
  });
});
