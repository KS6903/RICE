// The language the app is shown in.
//
// Every piece of UI text goes through t("…"), with the English text itself as
// the key: t("Rain likely after {{time}}", { time }). English needs no file.
// Each other language is one file, public/locales/<code>.json, mapping the
// English text to its translation; scripts/i18n/translate.mjs fills them from
// Google Translate and writes the list of languages (./languages.json). Nothing
// here names a language: the list and the files are the whole of it.
//
// The language is chosen before the app's modules run (main.tsx waits for
// startLanguage), so text worked out once when a module loads is already in
// it. Changing it saves the choice and reloads the page, which redraws every
// screen in the new language.
import i18next from "i18next";
import { setDefaultOptions, type Locale } from "date-fns";
import catalog from "./languages.json";
import englishPlurals from "./en.json";

export type Language = {
  /** The file's name and what the account saves: Google's language code. */
  code: string;
  /** The standard tag, for lang="…", plural rules and dates. */
  tag: string;
  /** The language's own name for itself. */
  name: string;
  /** Its name in English. */
  english: string;
  rtl?: boolean;
  /** Changes when the file does, so a browser never keeps an old copy. */
  version?: string;
};

export const DEFAULT_LANGUAGE = "en";
export const LANGUAGES: Language[] = catalog.languages as Language[];

const STORAGE_KEY = "oraiza:language";

void i18next.init({
  lng: DEFAULT_LANGUAGE,
  // A text with no translation yet shows in English: the key is the English.
  fallbackLng: false,
  keySeparator: false,
  nsSeparator: false,
  returnNull: false,
  returnEmptyString: false,
  initAsync: false,
  interpolation: { escapeValue: false },
  // English needs only its plural forms: "{{count}} tasks have_one", say.
  resources: { [DEFAULT_LANGUAGE]: { translation: englishPlurals } },
});

/** The UI text in the language on screen. */
export function t(key: string, values?: Record<string, unknown>): string {
  return i18next.t(key, values) as string;
}

/** English that is stored as data (an employee's position, say) and only
 *  translated where it's shown, with t(). It comes back as it is; marking it
 *  puts it in the language files. */
export const textKey = <T extends string>(text: T): T => text;

export function findLanguage(code: string | null | undefined): Language | undefined {
  if (!code) return undefined;
  return LANGUAGES.find((l) => l.code === code);
}

/** The language on screen. */
export function currentLanguage(): Language {
  return (
    findLanguage(i18next.language) ??
    findLanguage(DEFAULT_LANGUAGE) ?? {
      code: DEFAULT_LANGUAGE,
      tag: DEFAULT_LANGUAGE,
      name: "English",
      english: "English",
    }
  );
}

/** The standard tag of the language on screen, for Intl formatting. */
export function currentLocale(): string {
  return currentLanguage().tag;
}

function savedLanguage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function saveLanguage(code: string) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage blocked: the account's choice still applies after each sign-in.
  }
}

function markDocument(lang: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang.tag;
  document.documentElement.dir = lang.rtl ? "rtl" : "ltr";
}

/** Load the language this device last showed. English needs nothing loaded;
 *  if a file can't be fetched (offline, say) the app opens in English. */
export async function startLanguage(): Promise<void> {
  const lang = findLanguage(savedLanguage());
  if (!lang || lang.code === DEFAULT_LANGUAGE) {
    markDocument(currentLanguage());
    return;
  }
  try {
    const url = `${import.meta.env.BASE_URL}locales/${lang.code}.json${lang.version ? `?v=${lang.version}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    i18next.addResourceBundle(lang.code, "translation", await res.json());
    await i18next.changeLanguage(lang.code);
    markDocument(lang);
  } catch {
    markDocument(currentLanguage());
    return;
  }
  await loadDateNames(lang.tag);
}

/** Month and day names in dates (date-fns) in the language, where date-fns
 *  has it; otherwise they stay English. */
async function loadDateNames(tag: string) {
  try {
    const locales = (await import("date-fns/locale")) as unknown as Record<string, Locale>;
    // "zh-CN" is zhCN there, "sr-Latn" srLatn.
    const name = tag.replace(
      /-([A-Za-z0-9]+)/g,
      (_, part: string) => part[0].toUpperCase() + part.slice(1),
    );
    const locale = locales[name] ?? locales[tag.split("-")[0]];
    if (locale) setDefaultOptions({ locale });
  } catch {
    // Couldn't load: dates stay in English.
  }
}

/** Show the app in this language from now on: kept on this device, and the
 *  page reloads so every screen redraws in it. */
export function switchLanguage(code: string) {
  if (!findLanguage(code)) return;
  saveLanguage(code);
  if (code !== i18next.language) window.location.reload();
}

/** After sign-in: the account's own choice wins over this device's. An account
 *  that never chose keeps whatever this device shows. */
export function followAccountLanguage(code: string | null | undefined) {
  // Already this device's choice: done, even if its file couldn't be loaded
  // (offline), so the page never reloads over and over.
  if (!code || code === savedLanguage() || !findLanguage(code)) return;
  switchLanguage(code);
}
