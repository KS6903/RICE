// The reasons a rating can be given, in words. The codes are the server's
// (backend/app/api/feedback.py), which refuses any other.
import { t } from "../i18n";

export const OTHER_REASON = "other";

export const GOOD_REASONS = [
  "easy_to_use",
  "saves_time",
  "accurate_records",
  "useful_reports",
  "good_support",
];
export const BAD_REASONS = [
  "hard_to_use",
  "too_slow",
  "something_broken",
  "missing_feature",
  "too_expensive",
  "confusing_words",
];

/** 4 and 5 stars say what's good; 1 to 3 say what's wrong. */
export const reasonsFor = (rating: number) => (rating >= 4 ? GOOD_REASONS : BAD_REASONS);

export const ratingWords: Record<number, string> = {
  1: t("Very poor"),
  2: t("Poor"),
  3: t("Okay"),
  4: t("Good"),
  5: t("Excellent"),
};

const words: Record<string, string> = {
  easy_to_use: t("Easy to use"),
  saves_time: t("Saves me time"),
  accurate_records: t("Keeps my records accurate"),
  useful_reports: t("Useful reports"),
  good_support: t("Good support"),
  hard_to_use: t("Hard to use"),
  too_slow: t("Too slow"),
  something_broken: t("Something doesn't work right"),
  missing_feature: t("A feature I need is missing"),
  too_expensive: t("Too expensive"),
  confusing_words: t("Confusing words or translations"),
  [OTHER_REASON]: t("Other"),
};

export const reasonText = (code: string) => words[code] ?? code;
