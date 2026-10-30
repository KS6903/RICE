import { t } from "../i18n";

// What a form tells the user when they try to save it with something missing.

/** Under an empty field that has to be filled in. */
export const needsInput = () => t("This field needs an input.");

/** Under a dropdown that has to be chosen. */
export const needsChoice = () => t("Please select an option.");

/** Beside the Save button: the fields to look at are outlined in red. */
export const fixFields = () =>
  t("Some fields still need an input. Fill in the ones marked in red.");
