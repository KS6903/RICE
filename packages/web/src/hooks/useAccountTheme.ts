import { useLayoutEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";

/**
 * Keeps a user's theme inside their account. The app shells call this: while
 * one is mounted the signed-in user's saved theme is on screen, and when it
 * unmounts (signing out, an idle logout, or opening a public page such as
 * /legal) the page goes back to light.
 */
export function useAccountTheme() {
  const userId = useAuthStore((s) => s.user?.id);
  const enter = useThemeStore((s) => s.enter);
  const leave = useThemeStore((s) => s.leave);

  // A layout effect, so a dark account's first frame is already dark.
  useLayoutEffect(() => {
    if (!userId) return;
    enter(userId);
    return leave;
  }, [userId, enter, leave]);
}
