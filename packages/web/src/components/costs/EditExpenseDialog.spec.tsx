import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditExpenseDialog from "./EditExpenseDialog";
import { costsService } from "../../services/CostsService";
import { chooseOption } from "../../test/pickers";

const expense = {
  id: "e1",
  category_id: "fuel",
  batch_id: null,
  expense_date: "2026-10-20",
  amount: "1500.00",
  description: null,
  reference_no: null,
};
const categories = [
  { id: "fuel", name: "Fuel" },
  { id: "power", name: "Electricity" },
];

const draw = (onClose = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditExpenseDialog expense={expense} categories={categories} batches={[]} onClose={onClose} />
    </QueryClientProvider>,
  );

describe("Correcting a saved expense", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves the corrected category, amount and description", async () => {
    const save = vi.spyOn(costsService, "editExpense").mockResolvedValue(expense);
    const onClose = vi.fn();
    draw(onClose);

    await chooseOption("Category", "Electricity");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1850.50" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: " Meralco " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("e1", {
        category_id: "power",
        batch_id: null,
        expense_date: "2026-10-20",
        amount: 1850.5,
        description: "Meralco",
        reference_no: null,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("an empty amount can't be saved", () => {
    draw();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
