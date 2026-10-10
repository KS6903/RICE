import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import AutomationsPage from "./AutomationsPage";
import { useAuthStore } from "../stores/authStore";
import { automationsService, type Automation } from "../services/AutomationsService";

// The first render in a file pays for a cold start, which on a busy machine takes
// longer than the default second: the page was still showing its loading state and
// the first test failed, though it passes alone. Waiting longer costs nothing when
// the page is ready.
configure({ asyncUtilTimeout: 5000 });

const digest: Automation = {
  code: "owner_digest",
  title: "Morning summary",
  description: "Every morning, yesterday at a glance.",
  group: "reports",
  section: "reports",
  fields: [
    { name: "send_at", label: "Send at", kind: "time", help: "Before noon." },
    { name: "email", label: "Also email it", kind: "bool", help: "" },
  ],
  params: { send_at: "06:00", email: true },
  enabled: false,
  recipients: [],
  effective_recipients: ["u1"],
  default_roles: ["owner"],
  candidates: [
    { id: "u1", name: "Mill Owner", role: "owner" },
    { id: "u2", name: "Ana Books", role: "accountant" },
  ],
  last_run: null,
};

const bigSale: Automation = {
  ...digest,
  code: "big_transaction",
  title: "Big transaction",
  description: "A sale over your limit.",
  group: "watch",
  fields: [
    { name: "sale_over", label: "Sales over", kind: "money", help: "" },
    { name: "older_than", label: "Older than", kind: "number", help: "", unit: "hours" },
    {
      name: "mode",
      label: "When over the limit",
      kind: "select",
      help: "",
      options: [
        { value: "warn", label: "Warn me" },
        { value: "block", label: "Stop the order" },
      ],
    },
  ],
  params: { sale_over: 100000, older_than: 24, mode: "warn" },
};

const smallSet = {
  code: "small" as const,
  title: "Small mill, run by the owner",
  description: "The essentials, with nothing to set up.",
  recipes: [
    { code: "owner_digest", title: "Morning summary" },
    { code: "cash_up", title: "End-of-day cash-up" },
  ],
};

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const aiOffSettings = {
  enabled: false,
  language: "en",
  languages: [{ value: "en", label: "English" }],
  configured: true,
  changed_by: null,
  changed_at: null,
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AutomationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const card = (title: string) => screen.getByRole("article", { name: title });
const tab = (name: string) => screen.getByRole("tab", { name });

describe("AutomationsPage", () => {
  beforeEach(() => {
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [digest, bigSale] });
    vi.spyOn(automationsService, "presets").mockResolvedValue({ presets: [smallSet] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("puts each group on its own tab, opens the first, and counts what's on", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    expect(tab("Reports and summaries")).toHaveAttribute("aria-selected", "true");
    expect(tab("Owner watch")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Reports and summaries" })).toBeInTheDocument();
    // Only the open tab's recipes are on the page.
    expect(screen.queryByRole("heading", { name: "Big transaction" })).toBeNull();
    expect(screen.getByText(/0 of 2 switched on/)).toBeInTheDocument();

    fireEvent.click(tab("Owner watch"));
    const watch = screen.getByRole("tabpanel", { name: "Owner watch" });
    expect(within(watch).getByRole("heading", { name: "Big transaction" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Morning summary" })).toBeNull();
    // Groups with nothing in them get no tab.
    expect(screen.queryByRole("tab", { name: "Deliveries" })).toBeNull();
  });

  it("says nothing about health when runs are ticking and every email arrived", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({
      recipes: [digest],
      health: {
        scheduler_running: true,
        last_tick: "2026-10-10T00:00:00Z",
        emails: { failed: 0, retrying: 0 },
      },
    });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    expect(screen.queryByRole("region", { name: "Automation problems" })).toBeNull();
  });

  it("says plainly when runs are paused and emails didn't arrive", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({
      recipes: [digest],
      health: { scheduler_running: false, last_tick: null, emails: { failed: 2, retrying: 1 } },
    });
    draw();
    const box = await screen.findByRole("region", { name: "Automation problems" });
    expect(box).toHaveTextContent(/Automatic runs are paused on this server/);
    expect(box).toHaveTextContent(/haven't run yet/);
    expect(box).toHaveTextContent(/2 emails from your automations couldn't be delivered/);
    expect(box).toHaveTextContent(/1 email didn't go through the first time/);
  });

  it("offers the starter sets while nothing is on, and switches one on", async () => {
    useAuthStore.setState({ user: owner });
    const apply = vi
      .spyOn(automationsService, "applyPreset")
      .mockResolvedValue({ switched_on: ["owner_digest", "cash_up"] });
    draw();
    const sets = await screen.findByRole("region", { name: "Starter sets" });
    const small = await within(sets).findByRole("article", {
      name: "Small mill, run by the owner",
    });
    fireEvent.click(within(small).getByRole("button", { name: "Switch these on" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("small"));
    expect(
      await within(sets).findByText("Switched on: Morning summary, End-of-day cash-up."),
    ).toBeInTheDocument();
  });

  it("keeps the starter sets folded once something is on, and away from read-only users", async () => {
    useAuthStore.setState({ user: owner });
    vi.mocked(automationsService.list).mockResolvedValue({
      recipes: [{ ...digest, enabled: true }, bigSale],
    });
    const { unmount } = draw();
    const sets = await screen.findByRole("region", { name: "Starter sets" });
    expect(within(sets).getByRole("button", { name: "Show the sets" })).toBeInTheDocument();
    expect(automationsService.presets).not.toHaveBeenCalled();
    unmount();

    useAuthStore.setState({ user: { ...owner, role: "accountant" } });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    expect(screen.queryByRole("region", { name: "Starter sets" })).toBeNull();
  });

  it("moves between tabs with the arrow keys", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    fireEvent.keyDown(tab("Reports and summaries"), { key: "ArrowRight" });
    expect(tab("Owner watch")).toHaveAttribute("aria-selected", "true");
    expect(tab("Owner watch")).toHaveFocus();
    fireEvent.keyDown(tab("Owner watch"), { key: "ArrowRight" });
    expect(tab("Reports and summaries")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("Reports and summaries"), { key: "End" });
    expect(tab("Owner watch")).toHaveAttribute("aria-selected", "true");
  });

  it("folds what a recipe does behind an (i), instead of printing it", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    const note = "Every morning, yesterday at a glance.";
    expect(screen.queryByText(note)).toBeNull();

    const info = within(card("Morning summary")).getByRole("button", {
      name: "What Morning summary does",
    });
    fireEvent.click(info);
    expect(screen.getByRole("tooltip")).toHaveTextContent(note);
    expect(info).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);

    fireEvent.keyDown(info, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  describe("the note stays while it is read, and can be copied", () => {
    afterEach(() => vi.useRealTimers());

    const wait = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    // Hover the (i) with the clock stopped, so the grace period can be stepped through.
    const hoverTheInfo = async () => {
      useAuthStore.setState({ user: owner });
      draw();
      await screen.findByRole("heading", { name: "Morning summary" });
      vi.useFakeTimers();
      const info = within(card("Morning summary")).getByRole("button", {
        name: "What Morning summary does",
      });
      fireEvent.mouseEnter(info);
      return { info, note: screen.getByRole("tooltip") };
    };

    it("stays when the pointer crosses onto it, and goes when it leaves", async () => {
      const { info, note } = await hoverTheInfo();
      fireEvent.mouseLeave(info);
      wait(100); // still crossing the gap
      fireEvent.mouseEnter(note);
      wait(2000);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      fireEvent.mouseLeave(note);
      wait(200);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("goes if the pointer leaves the (i) and goes nowhere near it", async () => {
      const { info } = await hoverTheInfo();
      fireEvent.mouseLeave(info);
      wait(200);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("can be selected and copied: pressing in it pins it, even if a drag strays off it", async () => {
      const { note } = await hoverTheInfo();
      expect(note).not.toHaveClass("pointer-events-none");
      expect(note).toHaveClass("select-text");

      fireEvent.mouseDown(note);
      fireEvent.mouseLeave(note);
      wait(2000);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      // Scrolling inside it, or pressing in it again, doesn't put it away...
      fireEvent.scroll(note);
      fireEvent.mouseDown(note);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      // ...pressing anywhere else does.
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("goes when the page scrolls", async () => {
      await hoverTheInfo();
      fireEvent.scroll(window);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  describe("the note opens where it fits", () => {
    afterEach(() => {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
      // Own properties set below shadow the prototype's; drop them.
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    });

    // jsdom has no layout, so give the (i) a place on a 600px-high window and the
    // note a height of 120px.
    const openNoteWithTriggerAt = (top: number) => {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: () => 120,
      });
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        () => ({ top, bottom: top + 20, left: 40, right: 60, width: 20, height: 20 }) as DOMRect,
      );
      fireEvent.click(
        within(card("Morning summary")).getByRole("button", { name: "What Morning summary does" }),
      );
      return screen.getByRole("tooltip");
    };

    it("below the (i) when there is room", async () => {
      useAuthStore.setState({ user: owner });
      draw();
      await screen.findByRole("heading", { name: "Morning summary" });
      const note = openNoteWithTriggerAt(100);
      expect(note.style.top).toBe("128px");
      expect(note.style.bottom).toBe("");
    });

    it("above the (i) when it would run past the bottom of the window", async () => {
      useAuthStore.setState({ user: owner });
      draw();
      await screen.findByRole("heading", { name: "Morning summary" });
      const note = openNoteWithTriggerAt(560);
      expect(note.style.bottom).toBe("48px"); // window height 600 - (i) top 560 + gap 8
      expect(note.style.top).toBe("");
    });

    it("fixed in <body>, so it can't make the page scroll", async () => {
      useAuthStore.setState({ user: owner });
      draw();
      await screen.findByRole("heading", { name: "Morning summary" });
      const note = openNoteWithTriggerAt(560);
      expect(note.parentElement).toBe(document.body);
      expect(note).toHaveClass("fixed");
    });
  });

  it("offers AI advice on the morning summary only once AI is on", async () => {
    useAuthStore.setState({ user: owner });
    const advisable: Automation = {
      ...digest,
      ai_optional: true,
      fields: [
        digest.fields[0],
        { name: "ai_advice", label: "Add AI advice", kind: "bool", help: "" },
        digest.fields[1],
      ],
      params: { ...digest.params, ai_advice: false },
    };
    const list = vi
      .spyOn(automationsService, "list")
      .mockResolvedValue({ recipes: [advisable], ai: { ...aiOffSettings } });
    const { unmount } = draw();
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Add AI advice")).toBeDisabled();
    unmount();

    list.mockResolvedValue({ recipes: [advisable], ai: { ...aiOffSettings, enabled: true } });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Add AI advice")).toBeEnabled();
  });

  it("leaves the government-numbers reminder to the Employees page", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({
      recipes: [digest, { ...digest, code: "government_ids", title: "Missing", group: "people" }],
    });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    expect(screen.queryByRole("tab", { name: "People" })).toBeNull();
    expect(screen.getByText(/0 of 1 switched on/)).toBeInTheDocument();
  });

  it("tracks each alert as a task for the person picked, due within the time picked", async () => {
    useAuthStore.setState({ user: owner });
    const update = vi.spyOn(automationsService, "update").mockResolvedValue(digest);
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    fireEvent.click(within(card("Morning summary")).getByRole("button", { name: "Settings" }));
    expect(screen.queryByLabelText("Give it to")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Make each alert a task/));
    fireEvent.change(screen.getByLabelText("Give it to"), { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText("Due within"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("owner_digest", {
        enabled: false,
        params: { send_at: "06:00", email: true },
        recipients: [],
        track: true,
        track_assignee: "u2",
        track_due_hours: 6,
      }),
    );
  });

  it("keeps settings folded away until asked for", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    expect(screen.queryByLabelText("Send at")).toBeNull();
    fireEvent.click(within(card("Morning summary")).getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Send at")).toHaveValue("06:00");
    expect(screen.getByText(/goes to the owner: Mill Owner/)).toBeInTheDocument();
  });

  it("saves straight away when the switch is flipped", async () => {
    useAuthStore.setState({ user: owner });
    const update = vi
      .spyOn(automationsService, "update")
      .mockResolvedValue({ ...digest, enabled: true });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    fireEvent.click(within(card("Morning summary")).getByRole("switch"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("owner_digest", {
        enabled: true,
        params: { send_at: "06:00", email: true },
        recipients: [],
        track: false,
        track_assignee: null,
        track_due_hours: 24,
      }),
    );
  });

  it("shows money, units and choices, and saves edited settings", async () => {
    useAuthStore.setState({ user: owner });
    const update = vi.spyOn(automationsService, "update").mockResolvedValue(bigSale);
    draw();
    fireEvent.click(await screen.findByRole("tab", { name: "Owner watch" }));
    const big = card("Big transaction");
    fireEvent.click(within(big).getByRole("button", { name: "Settings" }));
    const save = within(big).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    expect(within(big).getByText("₱")).toBeInTheDocument();
    expect(within(big).getByText("hours")).toBeInTheDocument();
    fireEvent.change(within(big).getByLabelText("Sales over"), { target: { value: "150,000" } });
    fireEvent.change(within(big).getByLabelText("When over the limit"), {
      target: { value: "block" },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("big_transaction", {
        enabled: false,
        params: { sale_over: "150000", older_than: 24, mode: "block" },
        recipients: [],
        track: false,
        track_assignee: null,
        track_due_hours: 24,
      }),
    );
  });

  it("says so when a test had nothing to report", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "sendTest").mockResolvedValue({ sent: 0 });
    draw();
    fireEvent.click(await screen.findByRole("tab", { name: "Owner watch" }));
    const big = card("Big transaction");
    fireEvent.click(within(big).getByRole("button", { name: "Settings" }));
    fireEvent.click(within(big).getByRole("button", { name: /send me a test/i }));
    expect(await within(big).findByText(/Nothing to report right now/)).toBeInTheDocument();
  });

  it("is read-only for an accountant", async () => {
    useAuthStore.setState({ user: { ...owner, id: "u2", role: "accountant" } });
    draw();
    expect(screen.getByText(/only an owner or admin can change them/)).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Morning summary" });
    const summary = card("Morning summary");
    expect(within(summary).getByRole("switch")).toBeDisabled();
    fireEvent.click(within(summary).getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Send at")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /send me a test/i })).toBeNull();
  });
});

const briefing: Automation = {
  ...digest,
  code: "ai_briefing",
  title: "Morning briefing",
  description: "What to do first today.",
  group: "advisor",
  uses_ai: true,
};

const aiOff = {
  enabled: false,
  language: "en",
  languages: [
    { value: "en", label: "English" },
    { value: "taglish", label: "Taglish" },
    { value: "zh", label: "Simplified Chinese (简体中文)" },
    { value: "zh-hant", label: "Traditional Chinese (繁體中文)" },
  ],
  configured: true,
  changed_by: null,
  changed_at: null,
};

describe("AutomationsPage AI advisor", () => {
  beforeEach(() => {
    vi.spyOn(automationsService, "presets").mockResolvedValue({ presets: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  const aiBox = () => screen.findByRole("region", { name: "AI settings" });

  it("keeps AI recipes off until the owner presses Turn AI on", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [briefing], ai: aiOff });
    const updateAI = vi
      .spyOn(automationsService, "updateAI")
      .mockResolvedValue({ ...aiOff, enabled: true });
    draw();
    const box = await aiBox();
    expect(within(box).getByText("AI is off.")).toBeInTheDocument();
    expect(within(card("Morning briefing")).getByRole("switch")).toBeDisabled();
    expect(within(card("Morning briefing")).getByText("AI")).toBeInTheDocument();

    // A button, not a switch.
    expect(within(box).queryByRole("switch")).toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Turn AI on" }));
    await waitFor(() => expect(updateAI).toHaveBeenCalledWith({ enabled: true, language: "en" }));
  });

  it("turns AI off again with the same button, leaving the language as it was", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({
      recipes: [briefing],
      ai: { ...aiOff, enabled: true, language: "zh", changed_by: "Mill Owner" },
    });
    const updateAI = vi.spyOn(automationsService, "updateAI").mockResolvedValue(aiOff);
    draw();
    const box = await aiBox();
    expect(within(box).getByText("AI is on for your automations.")).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Turn AI on" })).toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Turn AI off" }));
    await waitFor(() => expect(updateAI).toHaveBeenCalledWith({ enabled: false, language: "zh" }));
  });

  it("saves a language as soon as it is picked, without touching on/off", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [briefing], ai: aiOff });
    const updateAI = vi
      .spyOn(automationsService, "updateAI")
      .mockResolvedValue({ ...aiOff, language: "taglish" });
    draw();
    const box = await aiBox();
    fireEvent.click(within(box).getByLabelText("Write the advice in"));
    expect(
      screen.getByRole("option", { name: "Simplified Chinese (简体中文)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Traditional Chinese (繁體中文)" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Taglish" }));
    await waitFor(() =>
      expect(updateAI).toHaveBeenCalledWith({ enabled: false, language: "taglish" }),
    );
  });

  it("puts the language and the button side by side", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [briefing], ai: aiOff });
    draw();
    const box = await aiBox();
    const language = within(box).getByLabelText("Write the advice in");
    const button = within(box).getByRole("button", { name: "Turn AI on" });
    // One row: the same wrapper holds both, and it lays its children out in a row.
    const row = language.closest("div.flex-wrap");
    expect(row).toContainElement(button);
    expect(row).toHaveClass("flex", "items-end");
  });

  it("lives in the AI advisor tab, which comes after the everyday ones", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({
      recipes: [briefing, digest],
      ai: aiOff,
    });
    draw();
    // The everyday tab opens first, without the AI settings.
    await screen.findByRole("article", { name: "Morning summary" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Reports and summaries",
      "AI advisor",
    ]);
    expect(screen.queryByRole("region", { name: "AI settings" })).toBeNull();

    fireEvent.click(tab("AI advisor"));
    const box = await aiBox();
    expect(box.closest('[role="tabpanel"]')).toHaveAttribute("id", "panel-advisor");
    expect(within(box).getByRole("button", { name: "Turn AI on" })).toBeInTheDocument();
  });

  it("explains what is sent behind a red (i), and names Oryza's AI", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [briefing], ai: aiOff });
    draw();
    const box = await aiBox();
    expect(screen.queryByText(/never sent/)).toBeNull();
    const info = within(box).getByRole("button", {
      name: "What the AI sends and what it doesn't",
    });
    expect(info).toHaveClass("text-rose-600");
    fireEvent.click(info);
    const note = screen.getByRole("tooltip");
    expect(note).toHaveTextContent(/never sent/);
    expect(note).toHaveTextContent(/Oryza's AI/);
    expect(note).not.toHaveTextContent(/DeepSeek/);
  });

  it("lets only the owner change it", async () => {
    useAuthStore.setState({ user: { ...owner, id: "u3", role: "admin" } });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [briefing], ai: aiOff });
    draw();
    const box = await aiBox();
    expect(within(box).getByText(/Only the mill's owner/)).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: /Turn AI/ })).toBeNull();
    expect(within(box).queryByLabelText("Write the advice in")).toBeNull();
  });

  it("puts the (i) right at the end of the automation's name, before the AI badge", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [briefing], ai: aiOff });
    draw();
    const title = await screen.findByRole("heading", { name: "Morning briefing" });
    const info = within(card("Morning briefing")).getByRole("button", {
      name: "What Morning briefing does",
    });
    const badge = within(card("Morning briefing")).getByText("AI");
    // The (i) is in the title's own text, in one no-wrap span with the name's last
    // word, so a wrapping title can't leave it alone on a line below.
    expect(title).toContainElement(info);
    const glued = info.closest("span.whitespace-nowrap");
    expect(glued).toHaveTextContent(/^briefing/);
    expect(glued?.parentElement).toBe(title);
    expect(glued?.previousSibling?.textContent).toBe("Morning ");
    expect(info.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
