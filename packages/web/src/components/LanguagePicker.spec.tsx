import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LanguagePicker from "./LanguagePicker";
import { authService } from "../services/AuthService";
import { LANGUAGES } from "../i18n";

// Switching reloads the page; here it only records what it was asked.
const switchLanguage = vi.hoisted(() => vi.fn());
vi.mock("../i18n", async (original) => ({
  ...(await original<typeof import("../i18n")>()),
  switchLanguage,
}));

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <LanguagePicker />
    </QueryClientProvider>,
  );

describe("LanguagePicker", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists every language in one list by name, English ticked, powered by Google", () => {
    draw();
    const list = screen.getByRole("radiogroup", { name: "Language" });
    const options = within(list).getAllByRole("radio");
    expect(options).toHaveLength(LANGUAGES.length);
    const names = LANGUAGES.map((l) => l.english).sort((a, b) => a.localeCompare(b));
    expect(LANGUAGES.find((l) => l.code === options[0].getAttribute("value"))?.english).toBe(
      names[0],
    );
    expect(within(list).getByRole("radio", { name: "English" })).toBeChecked();
    expect(screen.getByTestId("language-attribution")).toHaveTextContent("Powered by Google");
  });

  it("finds a language by its own name or its English one", () => {
    draw();
    fireEvent.change(screen.getByTestId("language-search"), { target: { value: "bisaya" } });
    const list = screen.getByRole("radiogroup", { name: "Language" });
    expect(
      within(list)
        .getAllByRole("radio")
        .map((o) => o.getAttribute("value")),
    ).toEqual(["ceb"]);

    fireEvent.change(screen.getByTestId("language-search"), {
      target: { value: "nothing like it" },
    });
    expect(screen.getByText(/No language matches/)).toBeInTheDocument();
  });

  it("saves the choice on the account, then switches", async () => {
    const save = vi.spyOn(authService, "setLanguage").mockResolvedValue({ language: "hil" });
    draw();
    fireEvent.click(screen.getByRole("radio", { name: /Hiligaynon/ }));
    await waitFor(() => expect(switchLanguage).toHaveBeenCalledWith("hil"));
    expect(save).toHaveBeenCalledWith("hil");
  });

  it("says so when the choice can't be saved, and stays", async () => {
    switchLanguage.mockClear();
    vi.spyOn(authService, "setLanguage").mockRejectedValue(new Error("offline"));
    draw();
    fireEvent.click(screen.getByRole("radio", { name: /Ilokano/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be saved");
    expect(switchLanguage).not.toHaveBeenCalled();
  });
});
