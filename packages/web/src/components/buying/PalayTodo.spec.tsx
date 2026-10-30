import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PalayTodo, { wetLinesToRecord } from "./PalayTodo";

const line = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  variety_code: "NSIC Rc 222",
  grade_code: null,
  sack_count: "20.00",
  net_weight_kg: "1000.000",
  moisture_content_pct: "24.00",
  is_wet: true,
  is_drying: true,
  ...over,
});

const purchase = (id: string, ref: string, date: string, items: any[]) => ({
  id,
  reference_no: ref,
  purchase_date: date,
  supplier: { name: "Mang Ben" },
  items,
});

const newer = purchase("p1", "PP-NEWER", "2026-10-12", [line("l1")]);
const older = purchase("p2", "PP-OLDER", "2026-10-10", [line("l2", { variety_code: "RC160" })]);
const dry = purchase("p3", "PP-DRY", "2026-10-11", [
  line("l3", { is_wet: false, is_drying: false }),
]);
const dried = purchase("p4", "PP-DRIED", "2026-10-09", [line("l4", { is_drying: false })]);

const draw = (purchases: any[], canRecord = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PalayTodo purchases={purchases} canRecord={canRecord} />
    </QueryClientProvider>,
  );

afterEach(() => vi.restoreAllMocks());

describe("wetLinesToRecord", () => {
  it("is the wet lines not yet dried, the oldest purchase first", () => {
    const todos = wetLinesToRecord([newer, dry, older, dried]);
    expect(todos.map((x) => [x.purchase.reference_no, x.line.id])).toEqual([
      ["PP-OLDER", "l2"],
      ["PP-NEWER", "l1"],
    ]);
  });

  it("is nothing when every wet line has its drying recorded", () => {
    expect(wetLinesToRecord([dry, dried])).toEqual([]);
  });
});

describe("The Palay page's To do window", () => {
  it("counts what is waiting on the button", () => {
    draw([newer, dry, older, dried]);
    expect(within(screen.getByTestId("palay-todo-button")).getByText("2")).toBeInTheDocument();
  });

  it("lists the wet palay waiting for its drying, the oldest first", () => {
    draw([newer, dry, older, dried]);
    fireEvent.click(screen.getByTestId("palay-todo-button"));

    const todoWindow = within(screen.getByTestId("palay-todo"));
    const items = todoWindow.getAllByTestId("palay-todo-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("PP-OLDER");
    expect(items[0]).toHaveTextContent("RC160");
    expect(items[0]).toHaveTextContent("1,000 kg");
    expect(items[0]).toHaveTextContent("20 sacks");
    expect(items[0]).toHaveTextContent("Mang Ben");
    expect(items[1]).toHaveTextContent("PP-NEWER");
    expect(todoWindow.queryByText("PP-DRY")).toBeNull();
    expect(todoWindow.queryByText("PP-DRIED")).toBeNull();
  });

  it("opens the drying record for the one picked", () => {
    draw([newer, older]);
    fireEvent.click(screen.getByTestId("palay-todo-button"));

    const [first] = within(screen.getByTestId("palay-todo")).getAllByTestId("palay-todo-item");
    fireEvent.click(within(first).getByRole("button", { name: "Record drying" }));

    expect(screen.getByTestId("record-drying")).toHaveTextContent("Record drying of PP-OLDER");
  });

  it("only shows what is waiting to someone who can't record it", () => {
    draw([newer], false);
    fireEvent.click(screen.getByTestId("palay-todo-button"));

    const todoWindow = within(screen.getByTestId("palay-todo"));
    expect(todoWindow.getByText("PP-NEWER")).toBeInTheDocument();
    expect(todoWindow.queryByRole("button", { name: "Record drying" })).toBeNull();
  });

  it("says there is nothing to do, and shows no count, when it is all recorded", () => {
    draw([dry, dried]);
    expect(within(screen.getByTestId("palay-todo-button")).queryByLabelText(/waiting/)).toBeNull();

    fireEvent.click(screen.getByTestId("palay-todo-button"));
    expect(screen.getByTestId("palay-todo")).toHaveTextContent("Nothing to do");
  });
});
