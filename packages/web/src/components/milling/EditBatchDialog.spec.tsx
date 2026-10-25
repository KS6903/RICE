import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditBatchDialog from "./EditBatchDialog";
import { millingService } from "../../services/MillingService";
import { chooseOption } from "../../test/pickers";

const batch = {
  id: "b1",
  batch_no: "MB-20261020-0001",
  equipment_id: null,
  customer_id: null,
  client_arrangement: null,
  client_notes: null,
  start_datetime: "2026-10-20T00:00:00Z",
  end_datetime: null,
  remarks: null,
  inputs: [
    { variety_id: "v1", grade_id: null, input_weight_kg: "1000.000", moisture_content_pct: null },
  ],
  outputs: [
    {
      output_type: "milled_rice",
      variety_id: "v1",
      output_weight_kg: "640.000",
      broken_rice_pct: null,
    },
    { output_type: "darak", variety_id: null, output_weight_kg: "90.000", broken_rice_pct: null },
  ],
};

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditBatchDialog
        batch={batch}
        equipment={[{ id: "e1", name: "Huller 1" }]}
        varieties={[{ id: "v1", code: "RC222" }]}
        clients={[{ id: "c1", name: "Mang Ador" }]}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );

describe("Correcting a saved milling batch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the corrected palay and outputs, and leaves the start time alone", async () => {
    const save = vi.spyOn(millingService, "editBatch").mockResolvedValue(batch);
    draw();

    fireEvent.change(screen.getByLabelText("Kilos of palay 1"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Kilos of output 1"), { target: { value: "780" } });
    fireEvent.click(screen.getByRole("button", { name: /Add output/ }));
    fireEvent.change(screen.getByLabelText("Kilos of output 3"), { target: { value: "30" } });
    await chooseOption("Machine", "Huller 1");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const [id, body] = save.mock.calls[0];
    expect(id).toBe("b1");
    expect(body).not.toHaveProperty("start_datetime");
    expect(body).toMatchObject({
      equipment_id: "e1",
      customer_id: null,
      client_arrangement: null,
      inputs: [
        { variety_id: "v1", grade_id: null, input_weight_kg: 1200, moisture_content_pct: null },
      ],
      outputs: [
        {
          output_type: "milled_rice",
          variety_id: "v1",
          output_weight_kg: 780,
          broken_rice_pct: null,
        },
        { output_type: "darak", variety_id: null, output_weight_kg: 90, broken_rice_pct: null },
        { output_type: "binlid", variety_id: null, output_weight_kg: 30, broken_rice_pct: null },
      ],
    });
  });

  it("a client's batch says what was agreed", async () => {
    const save = vi.spyOn(millingService, "editBatch").mockResolvedValue(batch);
    draw();
    await chooseOption("Client", "Mang Ador");
    await chooseOption("Arrangement", "We keep the ipa and darak");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toMatchObject({
      customer_id: "c1",
      client_arrangement: "mill_keeps_byproducts",
    });
  });

  it("an output with no kilos can't be saved", () => {
    draw();
    fireEvent.change(screen.getByLabelText("Kilos of output 2"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
