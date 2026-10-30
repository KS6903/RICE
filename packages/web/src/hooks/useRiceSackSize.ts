import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";

/** The sacks the Rice page can count its stock in, kilos each. Tapping the
 *  column header goes to the next one. */
export const SACK_SIZES = [50, 25] as const;
export type SackSize = (typeof SACK_SIZES)[number];

type Saved = { kg: SackSize; tapped: boolean };

const START: Saved = { kg: SACK_SIZES[0], tapped: false };

// Saved under the account's own key, like the inventory sort: still there the
// next time, on the same browser. `tapped` is whether the header has been
// tried, which is when its pulse stops.
const keyFor = (userId: string) => `rice-mill-rice-sack:${userId}`;

function read(userId: string | undefined): Saved {
  if (!userId) return START;
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(userId)) ?? "null");
    const kg = SACK_SIZES.find((size) => size === saved?.kg);
    return kg ? { kg, tapped: saved.tapped === true } : START;
  } catch {
    return START;
  }
}

/** The size of sack this account counts rice in (50 kg, or 25 kg), remembered
 *  between visits. `toggle` moves to the other; `other` is the one it moves to. */
export function useRiceSackSize() {
  const userId = useAuthStore((s) => s.user?.id);
  const [saved, setSaved] = useState<Saved>(() => read(userId));

  // Another account signing in on this browser gets its own choice.
  useEffect(() => setSaved(read(userId)), [userId]);

  const other = SACK_SIZES[(SACK_SIZES.indexOf(saved.kg) + 1) % SACK_SIZES.length];

  const toggle = useCallback(() => {
    const next: Saved = { kg: other, tapped: true };
    setSaved(next);
    if (!userId) return;
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(next));
    } catch {
      // Storage blocked (private mode): the choice lasts until the tab closes.
    }
  }, [other, userId]);

  return { kg: saved.kg, other, tapped: saved.tapped, toggle };
}
