import { create } from "zustand";

/**
 * Help that the user asks for: the guided tour (started from the help menu or
 * the dashboard checklist) and whether they've hidden the getting-started
 * checklist.
 */
type HelpState = {
  touring: boolean;
  startTour: () => void;
  stopTour: () => void;
  /** Bumped whenever a checklist is hidden or shown, so readers re-check. */
  checklistRevision: number;
};

export const useHelpStore = create<HelpState>((set) => ({
  touring: false,
  startTour: () => set({ touring: true }),
  stopTour: () => set({ touring: false }),
  checklistRevision: 0,
}));

const hiddenKey = (userId: string) => `oraiza:getting-started-hidden:${userId}`;
// Where browser storage is blocked (private windows, strict settings), the
// choice still holds for this visit.
const hiddenThisVisit = new Set<string>();

export function checklistHidden(userId: string): boolean {
  if (hiddenThisVisit.has(userId)) return true;
  try {
    return localStorage.getItem(hiddenKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function setChecklistHidden(userId: string, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(userId), "1");
    else localStorage.removeItem(hiddenKey(userId));
    hiddenThisVisit.delete(userId);
  } catch {
    if (hidden) hiddenThisVisit.add(userId);
    else hiddenThisVisit.delete(userId);
  }
  useHelpStore.setState((s) => ({ checklistRevision: s.checklistRevision + 1 }));
}
