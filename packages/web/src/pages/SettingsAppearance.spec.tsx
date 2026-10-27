import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import SettingsPage from "./SettingsPage";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";

// A cashier: the theme is a personal setting, so every role must reach it.
const cashier: User = {
  id: "u9",
  username: "cashier",
  full_name: "Mill Cashier",
  role: "cashier",
  company_id: "c1",
  features: [],
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Settings: Appearance", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: cashier });
    // The app shell does this on sign-in.
    useThemeStore.getState().enter(cashier.id);
  });

  afterEach(() => {
    useThemeStore.getState().leave();
    useAuthStore.setState({ user: null });
  });

  it("switches the account to dark mode and back", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    const light = screen.getByRole("radio", { name: "Light" });
    const dark = screen.getByRole("radio", { name: "Dark" });
    expect(light).toBeChecked();

    fireEvent.click(dark);
    expect(dark).toBeChecked();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("rice-mill-theme:u9")).toBe("dark");

    fireEvent.click(light);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("rice-mill-theme:u9")).toBe("light");
  });

  it("keeps the language on a tab of its own", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.queryByTestId("language-picker")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(screen.getByTestId("language-picker")).toHaveTextContent("Powered by Google");
    expect(screen.queryByRole("radio", { name: "Dark" })).toBeNull();
  });
});
