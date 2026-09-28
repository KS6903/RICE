import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import SignupPage from "./SignupPage";
import { legalService } from "../services/LegalService";

function draw(history: string[]) {
  vi.spyOn(legalService, "index").mockResolvedValue({
    agreement_version: "2026.1",
    bundle_hash: "bundle",
    documents: [],
  });
  return render(
    <GoogleOAuthProvider clientId="test">
      <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
        <Routes>
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/login" element={<p>Sign-in page</p>} />
          <Route path="/signup" element={<SignupPage />} />
        </Routes>
      </MemoryRouter>
    </GoogleOAuthProvider>,
  );
}

const back = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SignupPage back button", () => {
  it("returns to the page the visitor came from", async () => {
    draw(["/login", "/signup"]);
    back();
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
  });

  it("goes to the home page when there is nothing to go back to", async () => {
    draw(["/signup"]);
    back();
    expect(await screen.findByText("Home page")).toBeInTheDocument();
  });

  it("steps back from step 2 to step 1 without leaving the page", () => {
    draw(["/signup"]);
    fireEvent.change(screen.getByPlaceholderText("ABC Rice Mill Corp."), {
      target: { value: "Test Mill" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();

    back();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    // The company name typed on step 1 survives the round trip.
    expect(screen.getByPlaceholderText("ABC Rice Mill Corp.")).toHaveValue("Test Mill");
  });
});
