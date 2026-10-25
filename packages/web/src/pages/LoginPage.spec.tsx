import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import LoginPage from "./LoginPage";
import { authService } from "../services/AuthService";

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

describe("LoginPage when the account is locked", () => {
  const signInAs = (username: string) => {
    fireEvent.change(screen.getByPlaceholderText("your.username"), { target: { value: username } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  };
  const lockedBy = (code: string, detail: string) =>
    vi
      .spyOn(authService, "login")
      .mockRejectedValue({ response: { status: 429, data: { detail, code } } });

  it("tells an employee to ask their Boss, and a Boss to email the admin", async () => {
    lockedBy("account_locked_temporary", "This account is locked for 15 minutes.");
    draw(["/login"]);
    signInAs("maria");
    const help = await screen.findByRole("region", { name: "Locked out?" });
    expect(help).toHaveTextContent(/Employee: ask your Boss to give you a temporary password/);
    expect(help).toHaveTextContent(/Boss: email the admin/);
  });

  it("is the same for a permanent lock, which also keeps the reset link", async () => {
    lockedBy("account_locked", "Locked. Reset your password to regain access.");
    draw(["/login"]);
    signInAs("maria");
    expect(await screen.findByRole("region", { name: "Locked out?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reset your password to unlock/ })).toBeInTheDocument();
  });

  it("emails the admin for the username typed, and says only what the server said", async () => {
    lockedBy("account_locked_temporary", "This account is locked for 15 minutes.");
    const ask = vi
      .spyOn(authService, "requestLockoutHelp")
      .mockResolvedValue({ message: "If that is a locked Boss account, the admin has been told." });
    draw(["/login"]);
    signInAs("  theboss ");
    fireEvent.click(await screen.findByRole("button", { name: "Email the admin" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If that is a locked Boss account, the admin has been told.",
    );
    expect(ask).toHaveBeenCalledWith("theboss");
    // Once is enough: no second email from the same screen.
    expect(screen.getByRole("button", { name: "Email the admin" })).toBeDisabled();
  });

  it("says so when the request couldn't be sent", async () => {
    lockedBy("account_locked_temporary", "Locked.");
    vi.spyOn(authService, "requestLockoutHelp").mockRejectedValue({
      response: { status: 429, data: { detail: "Too many requests. Try again later." } },
    });
    draw(["/login"]);
    signInAs("theboss");
    fireEvent.click(await screen.findByRole("button", { name: "Email the admin" }));
    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent(
      "Too many requests. Try again later.",
    );
  });

  it("offers none of this for an ordinary wrong password", async () => {
    vi.spyOn(authService, "login").mockRejectedValue({
      response: { status: 401, data: { detail: "Invalid credentials" } },
    });
    draw(["/login"]);
    signInAs("maria");
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Locked out?" })).toBeNull();
  });
});

describe("LoginPage when the server is slow or doesn't answer", () => {
  const signIn = () => {
    fireEvent.change(screen.getByPlaceholderText("your.username"), { target: { value: "maria" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  };

  afterEach(() => vi.useRealTimers());

  it("says the server couldn't be reached, not that the password is wrong", async () => {
    vi.spyOn(authService, "login").mockRejectedValue({ request: {} });
    draw(["/login"]);
    signIn();
    expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument();
    expect(screen.queryByText("Invalid username or password.")).toBeNull();
  });

  it("says the server is still starting when the Worker couldn't wake it", async () => {
    vi.spyOn(authService, "login").mockRejectedValue({
      request: {},
      response: {
        status: 503,
        data: { detail: "Service temporarily unavailable", code: "upstream_unavailable" },
      },
    });
    draw(["/login"]);
    signIn();
    expect(await screen.findByText(/still starting up/)).toBeInTheDocument();
  });

  it("shows a loading page while signing in, and lifts it to say a password is wrong", async () => {
    let fail!: (err: unknown) => void;
    vi.spyOn(authService, "login").mockReturnValue(new Promise((_, reject) => (fail = reject)));
    draw(["/login"]);
    signIn();
    expect(screen.getByRole("status")).toHaveTextContent("Signing in…");

    act(() => fail({ response: { status: 401, data: {} } }));
    expect(await screen.findByText("Invalid username or password.")).toBeInTheDocument();
    expect(screen.queryByText("Signing in…")).toBeNull();
  });
});

describe("LoginPage Google sign-in", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is not offered when Google sign-in isn't set up, so no broken button and no console errors", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    draw(["/login"]);
    expect(screen.queryByText("Continue with Google")).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });

  it("is offered when a Google client ID is set", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    draw(["/login"]);
    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
  });
});
