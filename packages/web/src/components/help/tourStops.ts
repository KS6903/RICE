import type { AppSection, User } from "@rice-mill/shared";
import { planHas } from "../../hooks/useFeature";
import { NAV_GROUPS } from "../layout/navigation";
import { PAGE_WHAT } from "./guide";

export type TourStop = {
  key: string;
  /** `data-tour` value of the element to light up; null centers the card. */
  target: string | null;
  /** Page to open behind the card, so the user sees what's being described. */
  to?: string;
  group?: string;
  title: string;
  body: string;
};

/** Every page this user can open, in menu order, between a welcome and a
 *  pointer to the ? button that restarts it. Pages their role can't see, or their plan
 *  doesn't include, are skipped. */
export function tourStops(
  user: User | null | undefined,
  canView: (section: AppSection) => boolean,
): TourStop[] {
  const stops: TourStop[] = [
    {
      key: "welcome",
      target: null,
      title: "Welcome to Oraiza",
      body: "Let's take a quick look around. We'll open each part of the app and say what it's for. It takes about two minutes.",
    },
  ];
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!canView(item.section) || !planHas(user, item.feature ?? "dashboard")) continue;
      stops.push({
        key: item.to,
        target: `nav:${item.to}`,
        to: item.to,
        group: group.title ?? undefined,
        title: item.label,
        body: PAGE_WHAT[item.to] ?? item.hint,
      });
    }
  }
  stops.push(
    {
      key: "/settings",
      target: "nav:/settings",
      to: "/settings",
      title: "Settings",
      body: PAGE_WHAT["/settings"],
    },
    {
      key: "help",
      target: "help",
      title: "That's the tour",
      body: "Click ? any time to take it again.",
    },
  );
  return stops;
}
