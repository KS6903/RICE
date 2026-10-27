#!/usr/bin/env node
// Fills the web app's language files from Google Translate.
//
//   node scripts/i18n/translate.mjs                 every language Google offers
//   node scripts/i18n/translate.mjs --only tl,ceb   just these
//   node scripts/i18n/translate.mjs --check         what's missing, no network
//
// The English is the key (packages/web/src/i18n/index.ts). This collects every
// key: t("…"), tx("…") and textKey("…") in the web app, the labels in
// packages/shared/src/constants, and the backend's error messages
// (backend-messages.json, from backend_messages.py). Each language gets
// packages/web/public/locales/<code>.json; only keys not translated yet are
// sent, and keys no longer used are dropped. The list of languages, with their
// names, goes to packages/web/src/i18n/languages.json.
//
// Corrections go in scripts/i18n/overrides/<code>.json ({ "English": "fix" });
// they win over Google's on every run.
//
// Only the app's own text is sent to Google, never anything from the database.
// {{placeholders}} and the words in languages.config.json "keep" are marked
// not to be translated; a translation that loses a placeholder is left out, so
// that text shows in English.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const WEB_SRC = path.join(ROOT, "packages/web/src");
const SHARED_CONSTANTS = path.join(ROOT, "packages/shared/src/constants");
const LOCALES = path.join(ROOT, "packages/web/public/locales");
const LANGUAGE_LIST = path.join(WEB_SRC, "i18n/languages.json");
const ENGLISH_PLURALS = path.join(WEB_SRC, "i18n/en.json");
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "languages.config.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only =
  option("--only")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? null;

const SOURCE = "en";
const GOOGLE = "https://translate.googleapis.com";
// Google's codes that aren't the standard tag.
const TAG = { iw: "he", jw: "jv" };
const tagOf = (code) => TAG[code] ?? code;

// ── The keys ────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== "test") walk(p, out);
    } else if (/\.tsx?$/.test(f) && !/\.(spec|test)\.tsx?$|\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

/** Every key in the code, and which of them are counted (plural). */
function codeKeys() {
  const keys = new Set();
  const counted = new Set();
  for (const file of walk(WEB_SRC)) {
    const sf = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    (function visit(n) {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        ["t", "tx", "textKey"].includes(n.expression.text)
      ) {
        const [first, second] = n.arguments;
        if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
          keys.add(first.text);
          if (
            second &&
            ts.isObjectLiteralExpression(second) &&
            second.properties.some((p) => p.name?.getText() === "count")
          )
            counted.add(first.text);
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return { keys, counted };
}

/** The `label` strings in the shared constants (role names, customer types…). */
function sharedLabels() {
  const out = new Set();
  for (const f of fs.readdirSync(SHARED_CONSTANTS)) {
    const file = path.join(SHARED_CONSTANTS, f);
    const sf = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    (function visit(n) {
      if (
        ts.isPropertyAssignment(n) &&
        n.name.getText() === "label" &&
        ts.isStringLiteral(n.initializer)
      )
        out.add(n.initializer.text);
      ts.forEachChild(n, visit);
    })(sf);
  }
  return out;
}

function allKeys() {
  const { keys, counted } = codeKeys();
  for (const k of sharedLabels()) keys.add(k);
  const backend = path.join(HERE, "backend-messages.json");
  if (fs.existsSync(backend))
    for (const k of JSON.parse(fs.readFileSync(backend, "utf8"))) keys.add(k);
  const plurals = JSON.parse(fs.readFileSync(ENGLISH_PLURALS, "utf8"));
  // A counted key is plural only if English has its forms (en.json).
  const plural = new Map();
  for (const k of counted) {
    if (plurals[`${k}_one`] && plurals[`${k}_other`])
      plural.set(k, { one: plurals[`${k}_one`], other: plurals[`${k}_other`] });
  }
  const missingForms = [...counted].filter((k) => !plural.has(k) && /\{\{count\}\}/.test(k));
  return { keys: [...keys].sort(), plural, missingForms };
}

// ── Google ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function google(url, init, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status}`);
      if (i >= tries) throw new Error(`HTTP ${res.status} after ${tries} tries`);
    } catch (e) {
      if (i >= tries || (/HTTP 4/.test(String(e.message)) && !/429/.test(String(e.message))))
        throw e;
    }
    await sleep(Math.min(60_000, 1500 * 2 ** i));
  }
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeHtml = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const KEEP = [...CONFIG.keep].sort((a, b) => b.length - a.length);
const keepPattern = new RegExp(
  `\\b(${KEEP.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "g",
);

/** The text as Google gets it: placeholders and kept words marked off. */
function protect(text) {
  return escapeHtml(text)
    .replace(/\n/g, "<br>")
    .replace(/\{\{\w+\}\}/g, (m) => `<span translate="no">${m}</span>`)
    .replace(keepPattern, (m) => `<span translate="no">${m}</span>`);
}

function unprotect(html) {
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<span[^>]*translate\s*=\s*"?no"?[^>]*>\s*([\s\S]*?)\s*<\/span>/gi, "$1")
      .replace(/<\/?span[^>]*>/gi, ""),
  );
}

const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");

/** Translate texts into one language; undefined where it didn't come back whole. */
async function translateBatch(texts, target) {
  const body = new URLSearchParams();
  for (const t of texts) body.append("q", protect(t.trim()));
  const url = `${GOOGLE}/translate_a/t?client=gtx&sl=${SOURCE}&tl=${encodeURIComponent(target)}&format=html`;
  const out = await google(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
  });
  const list = Array.isArray(out) ? out : [out];
  return texts.map((src, i) => {
    let got = list[i];
    if (Array.isArray(got)) got = got[0];
    if (typeof got !== "string") return undefined;
    return accept(src, unprotect(got));
  });
}

/** A translation fit to show, tidied; undefined if it isn't: one that lost a
 *  placeholder or a kept word, or a short one that says an English word twice ("Dashboard ti
 *  Dashboard"). Left out, that text shows in English. */
function accept(src, text) {
  if (!text?.trim() || placeholders(text) !== placeholders(src)) return undefined;
  // Every kept word ("MTD", "Oraiza") must still be there, as it is.
  for (const w of src.match(keepPattern) ?? []) if (!text.includes(w)) return undefined;
  const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const english = words(src);
  const said = words(text);
  if (said.length <= 6) {
    const seen = new Set();
    for (const w of said) {
      if (seen.has(w) && english.includes(w) && english.filter((x) => x === w).length < 2)
        return undefined;
      seen.add(w);
    }
  }
  return tidy(src, text);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Google spaces out what was marked off ("{{time}} {{tomorrow}} ." for
 *  "{{time}}{{tomorrow}}."): where the English has no space next to a
 *  placeholder or a kept word, the translation gets none either. Also keeps the English's own
 *  leading and trailing spaces (" (optional)"), and drops a full stop Google
 *  added that the English doesn't have. */
function tidy(src, text) {
  let out = text.trim();
  // Placeholders, and the kept words ("Oraiza ?" for "Oraiza?").
  const marked = [...(src.match(/\{\{\w+\}\}/g) ?? []), ...(src.match(keepPattern) ?? [])];
  for (const p of new Set(marked)) {
    const after = src.match(new RegExp(`${escapeRe(p)}(\\S)`));
    if (after && !/[\p{L}\p{N}]/u.test(after[1]))
      out = out.replace(new RegExp(`${escapeRe(p)}\\s+(?=${escapeRe(after[1])})`, "g"), p);
    const before = src.match(new RegExp(`(\\S)${escapeRe(p)}`));
    if (before && !/[\p{L}\p{N}]/u.test(before[1]))
      out = out.replace(new RegExp(`(?<=${escapeRe(before[1])})\\s+${escapeRe(p)}`, "g"), p);
    if (src.includes(`${p}{{`))
      out = out.replace(new RegExp(`${escapeRe(p)}\\s+(?=\\{\\{)`, "g"), p);
  }
  if (!/[.!?。]\s*$/.test(src)) out = out.replace(/\s+\.$/, "");
  return src.match(/^\s*/)[0] + out + src.match(/\s*$/)[0];
}

/** Batches of at most 40 texts and about 4,000 characters. */
function batches(texts) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const t of texts) {
    const len = protect(t).length;
    if (cur.length && (cur.length >= 40 || size + len > 4000)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ── Languages ───────────────────────────────────────────────────────────────

async function googleLanguages() {
  const list = await google(`${GOOGLE}/translate_a/l?client=gtx&hl=en`);
  return Object.entries(list.tl).filter(([code]) => code !== "auto" && code !== SOURCE);
}

/** The language's name for itself; Google's English name when Intl has none
 *  (it then answers in English, "Abkhazian", which would show twice). */
function nativeName(code, english) {
  try {
    const tag = tagOf(code);
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    const inEnglish = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    if (name && name !== tag && name !== inEnglish)
      return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    /* not a tag Intl knows */
  }
  return english;
}

function isRtl(code) {
  try {
    const loc = new Intl.Locale(tagOf(code));
    const info = typeof loc.getTextInfo === "function" ? loc.getTextInfo() : loc.textInfo;
    return info?.direction === "rtl";
  } catch {
    return false;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
}

// ── One language ────────────────────────────────────────────────────────────

/** What the file should hold: a key per text, and per plural form. */
function wanted(keys, plural, code) {
  const categories = new Intl.PluralRules(tagOf(code)).resolvedOptions().pluralCategories;
  const out = [];
  for (const k of keys) {
    const forms = plural.get(k);
    if (!forms) out.push({ key: k, source: k });
    else
      for (const cat of categories)
        out.push({ key: `${k}_${cat}`, source: cat === "one" ? forms.one : forms.other });
  }
  return out;
}

async function fillLanguage(code, keys, plural) {
  const file = path.join(LOCALES, `${code}.json`);
  const old = readJson(file, {});
  const want = wanted(keys, plural, code);
  const next = {};
  const todo = [];
  for (const w of want) {
    const kept = typeof old[w.key] === "string" ? accept(w.source, old[w.key]) : undefined;
    if (kept) next[w.key] = kept;
    else todo.push(w);
  }
  const sources = [...new Set(todo.map((w) => w.source))];
  const done = new Map();
  let lost = 0;
  for (const batch of batches(sources)) {
    const got = await translateBatch(batch, code);
    batch.forEach((src, i) => (got[i] ? done.set(src, got[i]) : lost++));
    await sleep(250);
  }
  for (const w of todo) if (done.has(w.source)) next[w.key] = done.get(w.source);
  // Corrections by people who speak the language win over Google's.
  const overrides = readJson(path.join(HERE, "overrides", `${code}.json`), {});
  for (const w of want) if (typeof overrides[w.key] === "string") next[w.key] = overrides[w.key];
  const sorted = Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  writeJson(file, sorted);
  return { added: todo.length - lost, lost, total: want.length, have: Object.keys(sorted).length };
}

function versionOf(code) {
  const file = path.join(LOCALES, `${code}.json`);
  if (!fs.existsSync(file)) return undefined;
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const { keys, plural, missingForms } = allKeys();
  console.log(`${keys.length} texts, ${plural.size} with plural forms`);
  if (missingForms.length)
    console.warn(`No English plural forms in en.json for:\n  ${missingForms.join("\n  ")}`);

  if (flag("--check")) {
    for (const f of fs.existsSync(LOCALES) ? fs.readdirSync(LOCALES) : []) {
      const code = f.replace(/\.json$/, "");
      const have = readJson(path.join(LOCALES, f), {});
      const missing = wanted(keys, plural, code).filter((w) => !have[w.key]).length;
      if (missing) console.log(`${code}: ${missing} missing`);
    }
    return;
  }

  const languages = await googleLanguages();
  const targets = languages.filter(([code]) => !only || only.includes(code));

  let i = 0;
  const workers = Array.from({ length: Number(option("--parallel") ?? 3) }, async () => {
    while (i < targets.length) {
      const [code] = targets[i++];
      try {
        const r = await fillLanguage(code, keys, plural);
        console.log(
          `${code}: ${r.have}/${r.total}${r.added ? `, ${r.added} new` : ""}${r.lost ? `, ${r.lost} left in English` : ""}`,
        );
      } catch (e) {
        console.error(`${code}: stopped, ${e.message}. Run again to carry on.`);
      }
    }
  });
  await Promise.all(workers);

  // The list the picker shows: every language with a file, and English.
  const list = [{ code: SOURCE, tag: SOURCE, name: "English", english: "English" }];
  for (const [code, english] of languages) {
    if (!fs.existsSync(path.join(LOCALES, `${code}.json`))) continue;
    const names = CONFIG.names[code] ?? {};
    const entry = {
      code,
      tag: tagOf(code),
      name: names.name ?? nativeName(code, english),
      english: names.english ?? english,
    };
    if (isRtl(code)) entry.rtl = true;
    entry.version = versionOf(code);
    list.push(entry);
  }
  list.sort((a, b) => a.english.localeCompare(b.english));
  writeJson(LANGUAGE_LIST, { languages: list });
  console.log(`languages.json: ${list.length} languages`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
