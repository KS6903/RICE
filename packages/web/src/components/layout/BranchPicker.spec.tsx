import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import BranchPicker from "./BranchPicker";
import { authService } from "../../services/AuthService";
import { branchesService } from "../../services/BranchesService";
import { useAuthStore } from "../../stores/authStore";
import { useBranchStore } from "../../stores/branchStore";
import { chooseOption } from "../../test/pickers";

const main = { id: "b-main", name: "Main", is_main_branch: true };
const north = { id: "b-north", name: "North", is_main_branch: false };

const boss = (over: Partial<User> = {}): User => ({
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
  branch_id: "b-main",
  features: [],
  branch_view_default: "main",
  ...over,
});

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BranchPicker />
    </QueryClientProvider>,
  );

describe("BranchPicker", () => {
  beforeEach(() => {
    useBranchStore.setState({ view: null, owner: null });
    vi.spyOn(branchesService, "list").mockResolvedValue([main, north]);
    vi.spyOn(authService, "setBranchView").mockResolvedValue({ branch_view_default: "b-north" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("opens on the main branch by default", async () => {
    useAuthStore.setState({ user: boss() });
    draw();
    await waitFor(() => expect(useBranchStore.getState().view).toBe("b-main"));
    expect(screen.getByLabelText("Branch")).toHaveTextContent("Main (main)");
  });

  it("opens on all branches when that's the Boss's default", async () => {
    useAuthStore.setState({ user: boss({ branch_view_default: "all" }) });
    draw();
    await waitFor(() => expect(useBranchStore.getState().view).toBe("all"));
  });

  it("switches branch, and can open there next time", async () => {
    useAuthStore.setState({ user: boss() });
    draw();
    await waitFor(() => expect(useBranchStore.getState().view).toBe("b-main"));
    expect(screen.queryByRole("button", { name: "Open here by default" })).not.toBeInTheDocument();

    await chooseOption("Branch", "North");
    expect(useBranchStore.getState().view).toBe("b-north");

    fireEvent.click(screen.getByRole("button", { name: "Open here by default" }));
    await waitFor(() => expect(authService.setBranchView).toHaveBeenCalledWith("b-north"));
    await waitFor(() => expect(useAuthStore.getState().user?.branch_view_default).toBe("b-north"));
  });

  it("isn't there for a mill with one branch", async () => {
    vi.mocked(branchesService.list).mockResolvedValue([main]);
    useAuthStore.setState({ user: boss() });
    draw();
    await waitFor(() => expect(branchesService.list).toHaveBeenCalled());
    expect(screen.queryByLabelText("Branch")).not.toBeInTheDocument();
    expect(useBranchStore.getState().view).toBeNull();
  });

  it("isn't there for staff", () => {
    useAuthStore.setState({ user: boss({ role: "cashier" }) });
    draw();
    expect(screen.queryByLabelText("Branch")).not.toBeInTheDocument();
    expect(branchesService.list).not.toHaveBeenCalled();
  });
});
