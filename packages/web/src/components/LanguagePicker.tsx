import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Search } from "lucide-react";
import { clsx } from "clsx";
import { authService } from "../services/AuthService";
import { currentLanguage, LANGUAGES, switchLanguage, t, type Language } from "../i18n";

const byEnglishName = (a: Language, b: Language) => a.english.localeCompare(b.english);

/** Settings > Appearance: the language the app is shown in. Every language
 *  with a file in public/locales, the grouped ones (the Philippines') first,
 *  then the rest by name. Saved on the account, then the page reloads in it. */
export default function LanguagePicker() {
  const current = currentLanguage();
  const [query, setQuery] = useState("");
  const save = useMutation({
    mutationFn: (code: string) => authService.setLanguage(code),
    onSuccess: (_saved, code) => switchLanguage(code),
  });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = LANGUAGES.filter(
      (l) =>
        !q ||
        l.name.toLowerCase().includes(q) ||
        l.english.toLowerCase().includes(q) ||
        l.code.toLowerCase() === q,
    );
    const named = new Map<string, Language[]>();
    const rest: Language[] = [];
    for (const l of shown) {
      if (l.group) named.set(l.group, [...(named.get(l.group) ?? []), l]);
      else rest.push(l);
    }
    return [
      ...[...named].map(([group, langs]) => ({ label: t(group), langs })),
      { label: t("All languages"), langs: rest.sort(byEnglishName) },
    ].filter((g) => g.langs.length > 0);
  }, [query]);

  return (
    <fieldset data-testid="language-picker">
      <legend className="block text-sm font-semibold text-secondary mb-1.5">{t("Language")}</legend>
      <p className="text-sm text-secondary mb-3">
        {t(
          "The app's words in your language, on every device you sign in on. Translations come from Google Translate and can be wrong; what you type stays as you typed it.",
        )}
      </p>

      <div className="relative mb-2">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search languages")}
          aria-label={t("Search languages")}
          className="input pl-9"
          data-testid="language-search"
        />
      </div>

      <div
        role="radiogroup"
        aria-label={t("Language")}
        className="max-h-80 overflow-y-auto overscroll-contain rounded-xl ring-1 ring-soft"
      >
        {groups.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            {t("No language matches “{{query}}”.", { query: query.trim() })}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="sticky top-0 z-10 bg-slate-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-muted dark:bg-slate-800">
              {g.label}
            </p>
            {g.langs.map((l) => {
              const active = l.code === current.code;
              const saving = save.isPending && save.variables === l.code;
              return (
                <label
                  key={l.code}
                  className={clsx(
                    "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors has-[:focus-visible]:bg-emerald-500/10",
                    active ? "bg-emerald-500/10" : "hover:bg-slate-500/5",
                  )}
                >
                  <input
                    type="radio"
                    name="language"
                    value={l.code}
                    checked={active}
                    disabled={save.isPending}
                    onChange={() => save.mutate(l.code)}
                    className="sr-only"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      lang={l.tag}
                      dir={l.rtl ? "rtl" : undefined}
                      className="font-semibold text-primary"
                    >
                      {l.name}
                    </span>
                    {l.name !== l.english && <span className="ms-2 text-muted">{l.english}</span>}
                  </span>
                  {saving ? (
                    <Loader2 size={16} className="shrink-0 animate-spin text-muted" aria-hidden />
                  ) : (
                    active && (
                      <Check
                        size={16}
                        className="shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden
                      />
                    )
                  )}
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {save.isError && (
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-400" role="alert">
          {t("The language couldn't be saved. Check your connection and try again.")}
        </p>
      )}
    </fieldset>
  );
}
