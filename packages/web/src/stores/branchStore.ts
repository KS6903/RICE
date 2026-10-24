import { create } from "zustand";

/** The branch the Boss is looking at, from the top bar's picker
 *  (components/layout/BranchPicker.tsx): a branch id, "all", or null before the
 *  picker has opened on one. api.ts sends it as X-Branch on every request, and
 *  the server lists that branch's records and puts new ones there.
 *
 *  `owner` is whose choice it is, so another account signing in on this tab
 *  starts from its own default. Not saved: each sign-in opens on the default. */
type BranchState = {
  view: string | null;
  owner: string | null;
  setView: (view: string | null, owner: string | null) => void;
};

export const useBranchStore = create<BranchState>()((set) => ({
  view: null,
  owner: null,
  setView: (view, owner) => set({ view, owner }),
}));
