import { t } from "../i18n";

/** What a dropdown shows while nothing is chosen: "-- Select Grade --". The field's
 *  name is the dropdown's own label, so every dropdown asks the same way. */
export const selectPrompt = (what?: string): string =>
  what ? t("-- Select {{what}} --", { what }) : t("-- Select --");
