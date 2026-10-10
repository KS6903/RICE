import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import { MfaCard } from "./SettingsPage";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

// What /auth/me says about two-factor, with the usual case as the default: off,
// recommended, not required, nothing on file.
const showing = (mfa: Partial<User> = {}) =>
  vi.spyOn(authService, "me").mockResolvedValue({
    ...owner,
    mfa_enabled: false,
    mfa_setup_recommended: true,
    mfa_required: false,
    mfa_previous_authenticator: false,
    mfa_backup_codes_remaining: 0,
    ...mfa,
  } as User);

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MfaCard />
    </QueryClientProvider>,
  );

const type = (code: string) =>
  fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: code } });
const typePassword = (password: string) =>
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });

describe("MfaCard: two-factor is optional, and can be switched off and back on", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("offers to enable it, as a recommendation, when there is nothing on file", async () => {
    showing();
    draw();
    expect(
      await screen.findByRole("button", { name: "Enable two-factor authentication" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/is recommended/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /earlier authenticator/ })).toBeNull();
  });

  it("switches back on with the earlier authenticator: a code from it, and no new secret", async () => {
    showing({ mfa_previous_authenticator: true });
    const newSecret = vi.spyOn(authService, "mfaEnroll");
    const verify = vi
      .spyOn(authService, "mfaEnrollVerify")
      .mockResolvedValue({ message: "MFA enabled", backup_codes: ["AAAA-1111", "BBBB-2222"] });
    draw();
    expect(
      await screen.findByText("Off. Your earlier authenticator is still on file."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch back on with my earlier authenticator" }),
    );

    const confirm = screen.getByRole("button", { name: "Confirm & enable" });
    expect(confirm).toBeDisabled();
    type("123456");
    fireEvent.click(confirm);

    await waitFor(() => expect(verify).toHaveBeenCalledWith("123456"));
    expect(newSecret).not.toHaveBeenCalled();
    // Fresh recovery codes, shown once.
    expect(await screen.findByText(/AAAA-1111/)).toBeInTheDocument();
  });

  it("sets up a new authenticator instead, which replaces the earlier one", async () => {
    showing({ mfa_previous_authenticator: true });
    const newSecret = vi
      .spyOn(authService, "mfaEnroll")
      .mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/x" });
    draw();
    expect(await screen.findByText(/replaces the earlier one/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up a new authenticator" }));
    await waitFor(() => expect(newSecret).toHaveBeenCalled());
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  });

  it("can go back from either way of switching on", async () => {
    showing({ mfa_previous_authenticator: true });
    draw();
    fireEvent.click(
      await screen.findByRole("button", { name: "Switch back on with my earlier authenticator" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Switch back on with my earlier authenticator" }),
    ).toBeInTheDocument();
  });

  describe("turning it off takes the password and a code", () => {
    const openTheTurnOffStep = async () => {
      showing({ mfa_enabled: true, mfa_setup_recommended: false, mfa_backup_codes_remaining: 10 });
      draw();
      fireEvent.click(
        await screen.findByRole("button", { name: "Disable two-factor authentication" }),
      );
    };

    it("asks for both, and only then lets it go", async () => {
      const off = vi.spyOn(authService, "mfaDisable").mockResolvedValue({});
      useAuthStore.setState({ logout: vi.fn().mockResolvedValue(undefined) });
      await openTheTurnOffStep();
      const disable = screen.getByRole("button", { name: "Disable" });
      expect(disable).toBeDisabled();

      type("654321");
      expect(disable).toBeDisabled(); // the code alone isn't enough
      typePassword("Password123");
      expect(disable).toBeEnabled();
      fireEvent.click(disable);
      await waitFor(() => expect(off).toHaveBeenCalledWith("654321", "Password123"));
    });

    it("needs the password even when the code is there", async () => {
      await openTheTurnOffStep();
      type("654321");
      expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
      typePassword("Password123");
      typePassword("");
      expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
    });

    it("says what was wrong, keeps the code and clears the password", async () => {
      vi.spyOn(authService, "mfaDisable").mockRejectedValue({
        response: { data: { detail: "Current password is incorrect." } },
      });
      await openTheTurnOffStep();
      type("654321");
      typePassword("not-it");
      fireEvent.click(screen.getByRole("button", { name: "Disable" }));
      expect(await screen.findByText("Current password is incorrect.")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(screen.getByLabelText("Authenticator code")).toHaveValue("654321");
    });

    it("can be cancelled, forgetting what was typed", async () => {
      await openTheTurnOffStep();
      type("654321");
      typePassword("Password123");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Disable two-factor authentication" }));
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(screen.getByLabelText("Authenticator code")).toHaveValue("");
    });
  });

  it("won't offer to turn it off when the account's role must use it", async () => {
    showing({ mfa_enabled: true, mfa_required: true, mfa_setup_recommended: false });
    draw();
    expect(await screen.findByText(/is required for your role/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable two-factor authentication" })).toBeNull();
  });
});
