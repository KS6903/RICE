import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminFeedback from "./AdminFeedback";
import { adminService } from "../../services/AdminService";

const page = {
  summary: {
    count: 1,
    average: 2,
    by_rating: { "1": 0, "2": 1, "3": 0, "4": 0, "5": 0 },
    reasons: [{ code: "too_slow", count: 1 }],
  },
  items: [
    {
      id: "f1",
      company_id: "c1",
      company_name: "Rice Mill 1",
      user_name: "Ben",
      rating: 2,
      reasons: ["too_slow", "other"],
      other_text: "Receipts fail.",
      created_at: "2026-10-31T01:00:00+00:00",
    },
  ],
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AdminFeedback />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("AdminFeedback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows who rated what and why, and filters by rating", async () => {
    const list = vi.spyOn(adminService, "listFeedback").mockResolvedValue(page);
    draw();
    expect(await screen.findByRole("link", { name: "Rice Mill 1" })).toHaveAttribute(
      "href",
      "/admin/tenants/c1",
    );
    expect(screen.getByText("Ben")).toBeInTheDocument();
    expect(screen.getByText('"Receipts fail."')).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Poor" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filter by rating" }));
    fireEvent.click(await screen.findByRole("option", { name: "Poor" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(2));
  });
});
