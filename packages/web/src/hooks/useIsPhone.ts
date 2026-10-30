import { useSyncExternalStore } from "react";

/** Tailwind's `sm` is 640px: below it is a phone. */
const PHONE = "(max-width: 639px)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia?.(PHONE);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
};

/** Whether the screen is phone-sized, for a layout that has to change what it shows
 *  (a table that moves its extra columns under the first), not only how it looks. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(PHONE).matches ?? false,
    () => false,
  );
}
