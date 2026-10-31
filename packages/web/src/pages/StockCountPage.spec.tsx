import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import StockCountPage from "./StockCountPage";
import { useAuthStore } from "../stores/authStore";
import { stockCountService, type StockCountPage as Page } from "../services/StockCountService";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const page: Page = {
  sheet: [
    {
      kind: "byproduct",
      inventory_id: "b1",
      label: "By-product, darak",
      item: "darak",
      branch: null,
      branch_id: null,
    },
    {
      kind: "milled_rice",
      inventory_id: "r1",
      label: "Milled rice, NSIC Rc222 (grade Premium)",
      item: "NSIC Rc222 (grade Premium)",
      branch: null,
      branch_id: null,
    },
  ],
  tolerance_pct: 2,
  manager: true,
  choices: { defaults: {}, lines: {} },
  counts: [
    {
      id: "k1",
      date: "2026-10-01",
      branch: null,
      note: null,
      counted_by: "Ben",
      needs_review: true,
      reviewed_by: null,
      review_note: null,
      lines: [
        {
          label: "Milled rice, NSIC Rc222 (grade Premium)",
          recorded_kg: 5000,
          counted_kg: 4700,
          difference_kg: -300,
          out: true,
        },
      ],
    },
  ],
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <StockCountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("StockCountPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
    localStorage.clear();
  });

  it("counts blind and sends only the lines filled in", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(stockCountService, "page").mockResolvedValue(page);
    const record = vi.spyOn(stockCountService, "record").mockResolvedValue(page.counts[0]);
    draw();
    const sheet = await screen.findByRole("region", { name: "Count sheet" });
    // No recorded quantities on the sheet, and the lines sit under their kind.
    expect(within(sheet).queryByText(/5,000/)).toBeNull();
    expect(within(sheet).getByRole("group", { name: "Milled rice" })).toBeInTheDocument();
    const rice = within(sheet).getByRole("group", { name: "Milled rice" });
    fireEvent.click(within(rice).getByRole("radio", { name: "Kilos only" }));
    fireEvent.change(within(sheet).getByLabelText("Milled rice, NSIC Rc222 (grade Premium)"), {
      target: { value: "4,700" },
    });
    expect(within(sheet).getByText("1 of 2 counted")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Save the count" }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({
        lines: [{ kind: "milled_rice", inventory_id: "r1", counted_kg: "4700" }],
        note: "",
        branch_id: null,
      }),
    );
  });

  it("works out the kilos from sacks plus the loose kilos", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(stockCountService, "page").mockResolvedValue(page);
    const record = vi.spyOn(stockCountService, "record").mockResolvedValue(page.counts[0]);
    draw();
    const sheet = await screen.findByRole("region", { name: "Count sheet" });
    const rice = "Milled rice, NSIC Rc222 (grade Premium)";
    fireEvent.change(within(sheet).getByLabelText(`${rice}, sacks`), { target: { value: "94" } });
    fireEvent.change(within(sheet).getByLabelText(`${rice}, loose kg`), {
      target: { value: "12" },
    });
    expect(within(sheet).getByText("= 4,712 kg")).toBeInTheDocument();
    expect(within(sheet).getByText("1 of 2 counted")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /Save the count/ }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({
        lines: [{ kind: "milled_rice", inventory_id: "r1", counted_kg: "4712" }],
        note: "",
        branch_id: null,
      }),
    );
  });

  it("counts a line its own way and a kind of stock by its default, and keeps the choices", async () => {
    useAuthStore.setState({ user: owner });
    const twoRice: Page = {
      ...page,
      sheet: [
        ...page.sheet,
        {
          kind: "milled_rice",
          inventory_id: "r2",
          label: "Milled rice, Dinorado",
          item: "Dinorado",
          branch: null,
          branch_id: null,
        },
      ],
    };
    vi.spyOn(stockCountService, "page").mockResolvedValue(twoRice);
    const keep = vi
      .spyOn(stockCountService, "saveChoices")
      .mockResolvedValue({ defaults: {}, lines: {} });
    const record = vi.spyOn(stockCountService, "record").mockResolvedValue(page.counts[0]);
    draw();
    const sheet = await screen.findByRole("region", { name: "Count sheet" });

    // All rice in sacks of 25, except Dinorado in sacks of 10.
    fireEvent.change(within(sheet).getByLabelText("Kilos per sack, Milled rice"), {
      target: { value: "25" },
    });
    fireEvent.change(within(sheet).getByLabelText("Milled rice, Dinorado, kilos per sack"), {
      target: { value: "10" },
    });
    fireEvent.change(within(sheet).getByLabelText("Milled rice, Dinorado, sacks"), {
      target: { value: "3" },
    });
    fireEvent.change(
      within(sheet).getByLabelText("Milled rice, NSIC Rc222 (grade Premium), sacks"),
      { target: { value: "2" } },
    );
    // By-products keep their own default.
    expect(within(sheet).getByLabelText("Kilos per sack, By-products")).toHaveValue("50");

    fireEvent.click(within(sheet).getByRole("button", { name: "Save the count" }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({
        lines: expect.arrayContaining([
          { kind: "milled_rice", inventory_id: "r1", counted_kg: "50" },
          { kind: "milled_rice", inventory_id: "r2", counted_kg: "30" },
        ]),
        note: "",
        branch_id: null,
      }),
    );
    await waitFor(() =>
      expect(keep).toHaveBeenCalledWith({
        defaults: {
          milled_rice: { unit: "sacks", sack_kg: 25 },
          palay: { unit: "sacks", sack_kg: 50 },
          byproduct: { unit: "sacks", sack_kg: 50 },
        },
        lines: { r2: { sack_kg: 10 } },
      }),
    );
  });

  it("folds a line's sacks into kilos when it switches, and goes back to the default", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(stockCountService, "page").mockResolvedValue(page);
    vi.spyOn(stockCountService, "saveChoices").mockResolvedValue({ defaults: {}, lines: {} });
    draw();
    const sheet = await screen.findByRole("region", { name: "Count sheet" });
    const rice = "Milled rice, NSIC Rc222 (grade Premium)";
    fireEvent.change(within(sheet).getByLabelText(`${rice}, sacks`), { target: { value: "2" } });
    const own = within(sheet).getByRole("radiogroup", { name: `${rice}, count in` });
    fireEvent.click(within(own).getByRole("radio", { name: "Kilos" }));
    expect(within(sheet).getByLabelText(rice)).toHaveValue("100");
    fireEvent.click(within(sheet).getByRole("button", { name: `${rice}, use the default` }));
    expect(within(sheet).getByLabelText(`${rice}, loose kg`)).toHaveValue("100");
  });

  it("counts one branch at a time, and keeps what was typed for the other", async () => {
    useAuthStore.setState({ user: { ...owner, branch_id: "b-south" } as User });
    const branched: Page = {
      ...page,
      sheet: [
        {
          kind: "palay",
          inventory_id: "p1",
          label: "Palay, Rc222, North",
          item: "Rc222",
          branch: "North",
          branch_id: "b-north",
        },
        {
          kind: "palay",
          inventory_id: "p2",
          label: "Palay, Rc222, South",
          item: "Rc222",
          branch: "South",
          branch_id: "b-south",
        },
      ],
    };
    vi.spyOn(stockCountService, "page").mockResolvedValue(branched);
    const record = vi.spyOn(stockCountService, "record").mockResolvedValue(page.counts[0]);
    draw();
    const sheet = await screen.findByRole("region", { name: "Count sheet" });
    // Opens on the person's own branch.
    expect(within(sheet).queryByLabelText("Palay, Rc222, North, sacks")).toBeNull();
    fireEvent.change(within(sheet).getByLabelText("Palay, Rc222, South, sacks"), {
      target: { value: "4" },
    });
    expect(within(sheet).getByText("1 of 1 counted")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByLabelText("Branch you're counting"));
    fireEvent.click(await screen.findByRole("option", { name: "North" }));
    expect(within(sheet).queryByLabelText("Palay, Rc222, South, sacks")).toBeNull();
    expect(within(sheet).getByText("0 of 1 counted")).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("Palay, Rc222, North, sacks"), {
      target: { value: "1" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save the count" }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({
        lines: [{ kind: "palay", inventory_id: "p1", counted_kg: "50" }],
        note: "",
        branch_id: "b-north",
      }),
    );

    fireEvent.click(await within(sheet).findByLabelText("Branch you're counting"));
    fireEvent.click(await screen.findByRole("option", { name: "South" }));
    expect(within(sheet).getByLabelText("Palay, Rc222, South, sacks")).toHaveValue("4");
  });

  it("keeps an unsaved count through a reload", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(stockCountService, "page").mockResolvedValue(page);
    const first = draw();
    const sheet = await screen.findByRole("region", { name: "Count sheet" });
    fireEvent.change(within(sheet).getByLabelText("By-product, darak, sacks"), {
      target: { value: "7" },
    });
    first.unmount();
    draw();
    const again = await screen.findByRole("region", { name: "Count sheet" });
    expect(within(again).getByLabelText("By-product, darak, sacks")).toHaveValue("7");
  });

  it("shows the lines out and lets the owner review them", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(stockCountService, "page").mockResolvedValue(page);
    const review = vi.spyOn(stockCountService, "review").mockResolvedValue(page.counts[0]);
    draw();
    const card = await screen.findByRole("article", { name: /Count of/ });
    expect(within(card).getByText("1 line out")).toBeInTheDocument();
    expect(within(card).getByText("-300 kg")).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText("What you found"), {
      target: { value: "Spillage." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith("k1", "Spillage."));
  });
});
