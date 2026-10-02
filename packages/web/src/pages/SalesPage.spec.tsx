import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import SalesPage from "./SalesPage";
import { useAuthStore } from "../stores/authStore";
import { salesService } from "../services/SalesService";
import { inventoryService } from "../services/InventoryService";

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const overLimit = {
  response: {
    status: 409,
    data: {
      detail:
        "Aling Nena Store would owe ₱70,000 with this ₱50,000 order, over their ₱60,000 credit limit. They owe ₱20,000 now. Approve it to go ahead.",
      code: "over_credit_limit",
    },
  },
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SalesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("SalesPage credit-limit guard", () => {
  beforeEach(() => {
    vi.spyOn(salesService, "listOrders").mockResolvedValue([]);
    vi.spyOn(salesService, "listInvoices").mockResolvedValue([]);
    vi.spyOn(salesService, "listCustomers").mockResolvedValue([]);
    vi.spyOn(inventoryService, "getMilledRice").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("explains a stopped order and lets an owner approve it", async () => {
    useAuthStore.setState({ user: owner });
    const create = vi
      .spyOn(salesService, "createOrder")
      .mockRejectedValueOnce(overLimit)
      .mockResolvedValueOnce({ id: "o1" });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /new order/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create Order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/over their ₱60,000 credit limit/);

    fireEvent.click(screen.getByRole("button", { name: "Approve over the limit" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toMatchObject({ approve_over_limit: true });
  });

  it("offers no approval to staff", async () => {
    useAuthStore.setState({ user: { ...owner, role: "encoder" } });
    vi.spyOn(salesService, "createOrder").mockRejectedValue({
      response: {
        data: {
          ...overLimit.response.data,
          detail: "Over the limit. An owner or admin can approve it.",
        },
      },
    });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /new order/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create Order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/An owner or admin can approve it/);
    expect(screen.queryByRole("button", { name: "Approve over the limit" })).toBeNull();
  });
});
