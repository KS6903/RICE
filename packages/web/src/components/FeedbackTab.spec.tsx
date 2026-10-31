import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FeedbackTab from "./FeedbackTab";
import { feedbackService, type Feedback } from "../services/FeedbackService";

const saved: Feedback = {
  id: "f1",
  rating: 2,
  reasons: ["other"],
  other_text: "Receipts fail.",
  created_at: "2026-10-31T01:00:00+00:00",
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FeedbackTab />
    </QueryClientProvider>,
  );

describe("FeedbackTab", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows reasons for the rating, and Other must say why", async () => {
    vi.spyOn(feedbackService, "latest").mockResolvedValue(null);
    const send = vi.spyOn(feedbackService, "send").mockResolvedValue(saved);
    draw();
    const button = screen.getByRole("button", { name: "Send feedback" });
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Poor" }));
    expect(screen.queryByLabelText("Saves me time")).toBeNull();
    fireEvent.click(screen.getByLabelText("Other"));
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tell us your reason"), {
      target: { value: " Receipts fail. " },
    });
    fireEvent.click(screen.getByLabelText("Too slow"));
    fireEvent.click(button);

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        rating: 2,
        reasons: ["other", "too_slow"],
        other_text: "Receipts fail.",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Your feedback was sent");
    expect(screen.getByText('"Receipts fail."')).toBeInTheDocument();
  });

  it("drops a reason that doesn't fit the new rating, and keeps Other", async () => {
    vi.spyOn(feedbackService, "latest").mockResolvedValue(null);
    const send = vi.spyOn(feedbackService, "send").mockResolvedValue(saved);
    draw();
    fireEvent.click(screen.getByRole("radio", { name: "Poor" }));
    fireEvent.click(screen.getByLabelText("Too slow"));
    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByLabelText("Tell us your reason"), { target: { value: "Hm." } });
    fireEvent.click(screen.getByRole("radio", { name: "Excellent" }));
    expect(screen.queryByLabelText("Too slow")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ rating: 5, reasons: ["other"], other_text: "Hm." }),
    );
  });
});
