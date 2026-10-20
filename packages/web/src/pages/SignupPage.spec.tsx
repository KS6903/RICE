import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import SignupPage from "./SignupPage";
import { authService } from "../services/AuthService";
import { legalService } from "../services/LegalService";

type SignupConfig = { invite_required: boolean; turnstile_site_key: string | null };

function draw(
  history: string[],
  config: SignupConfig = { invite_required: true, turnstile_site_key: null },
) {
  vi.spyOn(authService, "signupConfig").mockResolvedValue(config);
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
  vi.unstubAllEnvs();
  delete window.turnstile;
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

describe("SignupPage terms checkbox", () => {
  const toStep2 = () => {
    fireEvent.change(screen.getByPlaceholderText("ABC Rice Mill Corp."), {
      target: { value: "Test Mill" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  };
  const fillStep2 = () => {
    for (const [placeholder, value] of [
      ["Juan Dela Cruz", "Juan Dela Cruz"],
      ["juandc", "juandc"],
      ["you@company.com", "juan@example.com"],
      ["8+ characters", "password123"],
      ["••••••••", "password123"],
    ]) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    }
  };
  const tickBox = () =>
    fireEvent.click(screen.getByRole("checkbox", { name: /i have read and accept/i }));

  it("won't create the account until the box is ticked", async () => {
    const signup = vi.spyOn(authService, "signup").mockRejectedValue(new Error("stop here"));
    draw(["/signup"]);
    toStep2();
    fillStep2();

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(screen.getByText(/tick the box/i)).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();

    // Ticking clears the reminder, and the acceptance goes out with the signup.
    tickBox();
    expect(screen.queryByText(/tick the box/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() =>
      expect(signup).toHaveBeenCalledWith(expect.objectContaining({ accepted_terms: true })),
    );
  });

  it("asks for the tick before Google's sign-in window, not after", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    draw(["/signup"]);
    toStep2();
    fireEvent.click(screen.getByRole("button", { name: "Sign up with Google" }));
    expect(screen.getByText(/tick the box/i)).toBeInTheDocument();

    // Once ticked, the cover is gone and clicks reach Google's own button.
    tickBox();
    expect(screen.queryByRole("button", { name: "Sign up with Google" })).toBeNull();
  });

  it("offers no Google sign-up when Google sign-in isn't set up", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    draw(["/signup"]);
    toStep2();
    expect(screen.queryByRole("button", { name: "Sign up with Google" })).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });
});

describe("SignupPage open sign-up", () => {
  const toStep2 = () => {
    fireEvent.change(screen.getByPlaceholderText("ABC Rice Mill Corp."), {
      target: { value: "Test Mill" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  };
  const fillStep2 = () => {
    for (const [placeholder, value] of [
      ["Juan Dela Cruz", "Juan Dela Cruz"],
      ["juandc", "juandc"],
      ["you@company.com", "juan@example.com"],
      ["8+ characters", "password123"],
      ["••••••••", "password123"],
    ]) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    }
    fireEvent.click(screen.getByRole("checkbox", { name: /i have read and accept/i }));
  };

  /** A stand-in for Cloudflare's script: records the widget and its callback. */
  const fakeTurnstile = () => {
    const widget: { options?: Record<string, any> } = {};
    const reset = vi.fn();
    window.turnstile = {
      render: (_el, options) => {
        widget.options = options;
        return "widget-1";
      },
      reset,
      remove: vi.fn(),
    };
    return { widget, reset };
  };

  it("doesn't ask for an invite code when anyone may sign up", async () => {
    draw(["/signup"], { invite_required: false, turnstile_site_key: null });
    await waitFor(() => expect(screen.queryByText("Invite code")).not.toBeInTheDocument());
  });

  it("asks for the invite code while sign-up is by invitation", async () => {
    draw(["/signup"]);
    expect(await screen.findByText("Invite code")).toBeInTheDocument();
  });

  it("waits for the bot check, sends its token, and asks for a fresh one after a failure", async () => {
    const { widget, reset } = fakeTurnstile();
    const signup = vi
      .spyOn(authService, "signup")
      .mockRejectedValue({ response: { data: { detail: "The bot check didn't pass." } } });
    draw(["/signup"], { invite_required: false, turnstile_site_key: "0x4AAA-site" });
    await waitFor(() => expect(screen.queryByText("Invite code")).not.toBeInTheDocument());
    toStep2();
    fillStep2();

    await waitFor(() => expect(widget.options?.sitekey).toBe("0x4AAA-site"));
    expect(widget.options?.action).toBe("signup");
    const create = screen.getByRole("button", { name: /create account/i });
    expect(create).toBeDisabled();

    act(() => widget.options?.callback("token-1"));
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => expect(signup).toHaveBeenCalled());
    expect(signup.mock.calls[0][0]).toMatchObject({ turnstile_token: "token-1" });
    expect(await screen.findByText("The bot check didn't pass.")).toBeInTheDocument();
    expect(reset).toHaveBeenCalledWith("widget-1");
    expect(create).toBeDisabled();
  });
});
