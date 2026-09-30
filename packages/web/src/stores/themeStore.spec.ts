import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "./themeStore";

const isDark = () => document.documentElement.classList.contains("dark");
const theme = () => useThemeStore.getState();

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    theme().leave();
  });

  it("starts in light mode", () => {
    expect(theme().theme).toBe("light");
    expect(isDark()).toBe(false);
  });

  it("gives an account that never chose light mode", () => {
    theme().enter("u1");
    expect(theme().theme).toBe("light");
    expect(isDark()).toBe(false);
  });

  it("keeps each account's choice to that account", () => {
    theme().enter("u1");
    theme().toggle();
    expect(isDark()).toBe(true);

    // Signing out goes back to light...
    theme().leave();
    expect(theme().theme).toBe("light");
    expect(isDark()).toBe(false);

    // ...the next person to sign in gets their own (light) theme...
    theme().enter("u2");
    expect(isDark()).toBe(false);
    theme().leave();

    // ...and the first account finds its dark mode waiting.
    theme().enter("u1");
    expect(theme().theme).toBe("dark");
    expect(isDark()).toBe(true);
  });

  it("can't be switched when nobody is signed in", () => {
    theme().toggle();
    theme().setTheme("dark");
    expect(theme().theme).toBe("light");
    expect(isDark()).toBe(false);
  });
});
