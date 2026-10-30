import { currentLanguage, currentLocale, DEFAULT_LANGUAGE } from "../i18n";

/** Sunday first: the language's short day names, two letters in English (Su, Mo). */
export const WEEKDAYS = Array.from({ length: 7 }, (_, i) => {
  // 1 January 2023 was a Sunday.
  const name = new Intl.DateTimeFormat(currentLocale(), { weekday: "short" }).format(
    new Date(2023, 0, 1 + i),
  );
  return currentLanguage().code === DEFAULT_LANGUAGE ? name.slice(0, 2) : name;
});
