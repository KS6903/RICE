import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentAccountsTab from "./PaymentAccountsTab";
import { adminService } from "../../services/AdminService";

const plan = (over: Record<string, unknown>) => ({
  id: "p",
  code: "p",
  name: "P",
  monthly_price: 999,
  annual_price: 0,
  max_users: null,
  max_branches: null,
  features: [],
  is_active: true,
  sort_order: 1,
  payment_bank: null,
  payment_account_name: null,
  payment_account_number: null,
  payment_qr_key: null,
  ...over,
});

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PaymentAccountsTab />
    </QueryClientProvider>,
  );

describe("Settings > Payment accounts", () => {
  beforeEach(() => {
    vi.spyOn(adminService, "getPlans").mockResolvedValue([
      plan({ id: "free", code: "free", name: "Free", monthly_price: 0, sort_order: 0 }),
      plan({
        id: "pro",
        code: "pro",
        name: "Pro",
        payment_bank: "MariBank",
        payment_account_name: "Oraiza",
        payment_account_number: "1238 7690 477",
        payment_qr_key: "payment-qr/pro/a.png",
      }),
    ]);
    vi.spyOn(adminService, "updatePaymentAccount").mockResolvedValue({});
    vi.spyOn(adminService, "uploadPaymentQr").mockResolvedValue({});
    vi.spyOn(adminService, "removePaymentQr").mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists only paid plans, with their account and QR code", async () => {
    draw();
    expect(await screen.findByRole("region", { name: "Pro payment account" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Free payment account" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Account number")).toHaveValue("1238 7690 477");
    expect(screen.getByRole("img", { name: "Pro payment QR code" })).toHaveAttribute(
      "src",
      "/api/media/payment-qr/pro/a.png",
    );
  });

  it("saves an edited account name and number", async () => {
    draw();
    const number = await screen.findByLabelText("Account number");
    const save = screen.getByRole("button", { name: "Save account" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Oraiza Inc" } });
    fireEvent.change(number, { target: { value: "1238 0000 477" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(adminService.updatePaymentAccount).toHaveBeenCalledWith("pro", {
        payment_bank: "MariBank",
        payment_account_name: "Oraiza Inc",
        payment_account_number: "1238 0000 477",
      }),
    );
  });

  it("uploads a new QR picture, or removes it", async () => {
    draw();
    const input = await screen.findByLabelText("Upload Pro QR code");
    const file = new File([new Uint8Array([137, 80, 78, 71])], "qr.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(adminService.uploadPaymentQr).toHaveBeenCalledWith("pro", file));

    fireEvent.click(screen.getByRole("button", { name: "Remove Pro QR code" }));
    await waitFor(() => expect(adminService.removePaymentQr).toHaveBeenCalledWith("pro"));
  });
});
