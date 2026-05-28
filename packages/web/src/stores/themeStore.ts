import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
  root.style.colorScheme = t;
}

function detectInitial(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = JSON.parse(localStorage.getItem("rice-mill-theme") || "null");
    if (stored?.state?.theme === "light" || stored?.state?.theme === "dark") {
      return stored.state.theme;
    }
  } catch {
    // ignore parse errors and fall through to system pref
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const initial = detectInitial();
applyTheme(initial);

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: initial,
      setTheme: (t) => {
        applyTheme(t);
        set({ theme: t });
      },
      toggle: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        applyTheme(next);
        set({ theme: next });
      },
    }),
    {
      name: "rice-mill-theme",
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme);
      },
    }
  )
);
