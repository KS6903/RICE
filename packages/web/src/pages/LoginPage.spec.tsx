import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import LoginPage from "./LoginPage";

function draw(history: string[]) {
  return render(
    <GoogleOAuthProvider clientId="test">
      <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
        <Routes>
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/signup" element={<p>Signup page</p>} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </GoogleOAuthProvider>,
  );
}

const back = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LoginPage back button", () => {
  it("uses the same shared component as SignupPage's back button", () => {
    const { container } = draw(["/login"]);
    expect(screen.getByRole("button", { name: "Back" }).className).toContain("btn-back");
    // No leftover of the page-local design this button used to have.
    expect(container.innerHTML).not.toContain("lp-back");
  });

  it("returns to the previous page when there is browser history", async () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(2);
    draw(["/signup", "/login"]);
    back();
    expect(await screen.findByText("Signup page")).toBeInTheDocument();
  });

  it("goes to the home page when there is no browser history to go back to", async () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    draw(["/login"]);
    back();
    expect(await screen.findByText("Home page")).toBeInTheDocument();
  });
});
