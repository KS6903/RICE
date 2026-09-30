import { create } from "zustand";

export type Theme = "light" | "dark";

// Each account's choice is saved under its own key, so one person's dark mode
// never carries over to the public pages or to the next person who signs in
// on this browser.
const keyFor = (userId: string) => `rice-mill-theme:${userId}`;
// The old device-wide setting. Dropped, so everyone starts in light mode.
const LEGACY_KEY = "rice-mill-theme";

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
  root.style.colorScheme = t;
}

function savedTheme(userId: string): Theme {
  try {
    return localStorage.getItem(keyFor(userId)) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function saveTheme(userId: string, t: Theme) {
  try {
    localStorage.setItem(keyFor(userId), t);
  } catch {
    // Storage blocked (private mode): the choice lasts until the tab closes.
  }
}

interface ThemeState {
  /** The theme on screen: the signed-in account's choice inside the app,
   *  light everywhere else. */
  theme: Theme;
  /** The account whose choice is on screen; null on the public pages. */
  owner: string | null;
  /** Put an account's saved theme on screen (light if it never chose). */
  enter: (userId: string) => void;
  /** Back to light, e.g. on signing out. */
  leave: () => void;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

try {
  localStorage.removeItem(LEGACY_KEY);
} catch {
  // Storage blocked: nothing was saved there either.
}
applyTheme("light");

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: "light",
  owner: null,
  enter: (userId) => {
    const t = savedTheme(userId);
    applyTheme(t);
    set({ theme: t, owner: userId });
  },
  leave: () => {
    applyTheme("light");
    set({ theme: "light", owner: null });
  },
  setTheme: (t) => {
    const { owner } = get();
    // Only an account has a theme; the public pages are always light.
    if (!owner) return;
    saveTheme(owner, t);
    applyTheme(t);
    set({ theme: t });
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
