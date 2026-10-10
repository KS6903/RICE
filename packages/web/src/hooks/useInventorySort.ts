import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import {
  DEFAULT_INVENTORY_SORT,
  isInventorySort,
  type InventorySort,
} from "../mappers/InventoryMapper";

// Saved under the account's own key, like the theme. Signing out does not touch
// it, and nothing expires it, so the choice is still there months later on the
// same browser.
const keyFor = (userId: string) => `rice-mill-inventory-sort:${userId}`;

function read(userId: string | undefined): InventorySort {
  if (!userId) return DEFAULT_INVENTORY_SORT;
  try {
    const saved = localStorage.getItem(keyFor(userId));
    return isInventorySort(saved) ? saved : DEFAULT_INVENTORY_SORT;
  } catch {
    return DEFAULT_INVENTORY_SORT;
  }
}

/** How this account wants the inventory ordered, remembered between visits. */
export function useInventorySort(): [InventorySort, (next: InventorySort) => void] {
  const userId = useAuthStore((s) => s.user?.id);
  const [sort, setSort] = useState<InventorySort>(() => read(userId));

  // Another account signing in on this browser gets its own choice.
  useEffect(() => setSort(read(userId)), [userId]);

  const update = useCallback(
    (next: InventorySort) => {
      setSort(next);
      if (!userId) return;
      try {
        localStorage.setItem(keyFor(userId), next);
      } catch {
        // Storage blocked (private mode): the choice lasts until the tab closes.
      }
    },
    [userId],
  );

  return [sort, update];
}
