#!/usr/bin/env node
// Wraps the web app's English UI text in t("…") so it can be translated.
//
//   node scripts/i18n/mark-strings.mjs [files…] [--report out.json] [--dry]
//
// With no files, every .ts/.tsx under packages/web/src except specs. It finds
// JSX text, text-bearing JSX attributes and object properties, and strings and
// template literals in display positions; it leaves class names, keys, paths,
// comparisons and the like alone. The English text is the key (natural-language
// keys): t("Rain likely after {{time}}", { time }). Run it again after adding
// screens; strings already inside t() are skipped. Review the report: a string
// that looks like text but is data (a status sent to the API, say) belongs in
// SKIP below.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "packages/web/src");
const I18N_MODULE = path.join(SRC, "i18n");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const reportAt = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
const fileArgs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--report");

/** Files and strings that read like text but are data: never wrapped. */
const skipList = JSON.parse(fs.readFileSync(new URL("./skip.json", import.meta.url), "utf8"));
const SKIP = new Set(skipList.strings);
const SKIP_FILES = new Set(skipList.files);

/** JSX attributes whose string value is shown to people. */
const TEXT_ATTR =
  /^(aria-label|aria-description|aria-valuetext|alt|title|label|placeholder|sublabel|subtitle|emptyText|empty|confirmLabel|cancelLabel|okLabel|newPlaceholder|reason|hint|description|desc|text|message|tooltip|caption|heading|cta|prompt|body|blurb|summary|note|helper|helperText|error|warning|what|why|headline|detail|legend|unit|suffix|prefix|badge)$/;

/** Object properties whose string value is data or styling, never text. */
const DATA_PROP =
  /^(className|class|iconBg|icon|color|fill|stroke|boxShadow|backgroundColor|background|tint|bg|ring|.*Class|.*ClassName|id|key|type|kind|variant|href|to|path|url|src|role|status|method|value|code|mode|feature|requires|queryKey|testid|testId|dataTestid|format|pattern|inputMode|autoComplete|align|side|position|size|weight|font|fontFamily|transform|transition|animation|width|height|gradient|rootMargin|currency)$/;

/** Calls whose string arguments are never text. */
const DATA_CALL =
  /(^|\.)(clsx|cn|format|formatISO|parse|parseISO|matchMedia|querySelector|querySelectorAll|getElementById|getItem|setItem|removeItem|addEventListener|removeEventListener|includes|startsWith|endsWith|split|replace|replaceAll|join|padStart|padEnd|indexOf|lastIndexOf|match|test|toLocaleString|toLocaleDateString|toLocaleTimeString|NumberFormat|DateTimeFormat|log|warn|error|info|debug|navigate|get|post|put|patch|delete|request|useFeature|canView|canEdit|canDo|t|require|fetch|open|createElement|setAttribute|getAttribute|removeAttribute|toggle|add|remove|contains|has|set|append|useQuery|useMutation|invalidateQueries|setQueryData|getQueryData|removeQueries|cancelQueries|refetchQueries|Error|TypeError|RegExp|Date|URL|URLSearchParams|Blob|File|encodeURIComponent|decodeURIComponent|atob|btoa|Symbol|assign|defineProperty|localeCompare|scrollIntoView|focus|dispatchEvent|Event|CustomEvent|postMessage|emit|on|off|once|matches|closest|startTransition|track|setTimeout|setInterval|keys|values|entries|from|of|isArray|stringify|parse|sort|filter|find|some|every|map|forEach|reduce|concat|slice|splice|push|unshift|at|fill|repeat|trim|charAt|substring|substr|toUpperCase|toLowerCase|normalize|raw|create|persist|devtools|useStore|subscribe|getState|setState|Number|String|Boolean|parseInt|parseFloat|isNaN|lazy|import|useSearchParams|useParams|searchParams|params)$/;

const TAILWIND_TOKEN =
  /^(!?-?[a-z]+:)*!?-?(?:[a-z]+(?:-[a-z0-9./[\]%#():,_]+)*|\[[^\]]+\])(?:\/\d+)?$/;

const UTILITY =
  /^(!?-?(?:[a-z0-9]+:)*)(flex|grid|block|inline|hidden|contents|group|peer|absolute|relative|fixed|sticky|static|truncate|uppercase|lowercase|capitalize|italic|underline|sr-only|container|isolate|shrink|grow|transition|animate|outline|ring|border|shadow|rounded|divide|space|gap|items|justify|self|place|content|order|col|row|overflow|overscroll|object|z|inset|top|right|bottom|left|p[xytrbl]?|m[xytrbl]?|w|h|min|max|size|text|font|tracking|leading|bg|from|via|to|fill|stroke|opacity|blur|backdrop|cursor|select|pointer|resize|scroll|snap|touch|aspect|line|list|align|whitespace|break|decoration|indent|duration|ease|delay|scale|rotate|translate|skew|origin|accent|caret|appearance|will|table|float|clear|visible|invisible|collapse|tabular|ordinal|slashed|antialiased|subpixel|not|prose|motion|forced|print|has|aria|data|dark)(-|$|\[|\/)/;

/** "px-3 py-1 text-xs" and friends. */
function looksLikeClasses(s) {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const hits = toks.filter(
    (tok) => UTILITY.test(tok) || (TAILWIND_TOKEN.test(tok) && /[-:[]/.test(tok)),
  ).length;
  return hits / toks.length >= 0.6 && toks.some((tok) => /[-:[]/.test(tok));
}

/** Whether a string reads as words shown to a person. */
function looksLikeText(s) {
  const v = s.trim();
  if (!/[A-Za-z]{2}/.test(v)) return false;
  if (/^(https?:|mailto:|tel:|data:|\/|\.\/|\.\.\/|#|@|\$\{)/.test(v)) return false;
  if (/^[a-z0-9_.:/-]+$/.test(v)) return false; // identifiers, keys, paths
  if (/^[A-Z0-9_]+$/.test(v) && v.length > 1 && !/^[A-Z]{2,4}$/.test(v)) return false; // CONSTANT_CASE
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(v)) return false; // camelCase
  if (/^[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+$/.test(v)) return false; // PascalCase
  if (looksLikeClasses(v)) return false;
  if (/^[yMdHhmsaEGQLwWuiIoT ,.:/'-]+$/.test(v) && /(yyyy|MM|dd|HH|mm|EEE|MMM)/.test(v))
    return false; // date formats
  if (/^[\w-]+\/[\w.+-]+$/.test(v)) return false; // mime types
  if (/^(application|text|image)\//.test(v)) return false;
  if (/^(rgba?|hsla?|var|calc|url|linear-gradient|radial-gradient)\(|^#[0-9a-f]{3,8}$/i.test(v))
    return false; // CSS values
  if (/^Bearer\b/.test(v)) return false;
  if (/^[?&][\w=&.%-]+$/.test(v)) return false; // query strings
  return true;
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  rsquo: "\u2019",
  lsquo: "\u2018",
  ldquo: "\u201c",
  rdquo: "\u201d",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  middot: "\u00b7",
  times: "\u00d7",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  larr: "\u2190",
  rarr: "\u2192",
  uarr: "\u2191",
  darr: "\u2193",
  bull: "\u2022",
  deg: "\u00b0",
  peso: "\u20b1",
  minus: "\u2212",
  plusmn: "\u00b1",
};
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#")
      return String.fromCodePoint(parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** How React renders a JSX text child (Babel's cleanJSXElementLiteralChild). */
function jsxRendered(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = 0;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) last = i;
  });
  let out = "";
  lines.forEach((line, i) => {
    let s = line.replace(/\t/g, " ");
    if (i !== 0) s = s.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) s = s.replace(/[ ]+$/, "");
    if (s) {
      if (i !== last) s += " ";
      out += s;
    }
  });
  return decodeEntities(out);
}

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (p !== I18N_MODULE && path.basename(p) !== "test") walk(p, out);
    } else if (/\.tsx?$/.test(f) && !/\.(spec|test)\.tsx?$|vite-env\.d\.ts$|\.d\.ts$/.test(f))
      out.push(p);
  }
  return out;
}

/** A name for an interpolated value: the last word of the expression. */
function placeholderName(expr, used) {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e))
    e = e.expression;
  let name = null;
  if (ts.isIdentifier(e)) name = e.text;
  else if (
    ts.isPropertyAccessExpression(e) &&
    /^(length|size)$/.test(e.name.text) &&
    (ts.isIdentifier(e.expression) || ts.isPropertyAccessExpression(e.expression))
  )
    name = `${placeholderName(e.expression, new Set())}Count`;
  else if (ts.isPropertyAccessExpression(e)) name = e.name.text;
  else if (ts.isCallExpression(e)) {
    const a = e.arguments[0];
    if (a && (ts.isIdentifier(a) || ts.isPropertyAccessExpression(a) || ts.isCallExpression(a)))
      name = placeholderName(a, new Set());
    else if (ts.isPropertyAccessExpression(e.expression)) {
      const obj = e.expression.expression;
      name =
        ts.isIdentifier(obj) || ts.isPropertyAccessExpression(obj)
          ? placeholderName(obj, new Set())
          : e.expression.name.text;
    } else if (ts.isIdentifier(e.expression)) name = e.expression.text;
  } else if (ts.isElementAccessExpression(e)) name = placeholderName(e.expression, new Set());
  if (!name || !/^[A-Za-z_]\w*$/.test(name)) name = "value";
  if (name.length > 24) name = name.slice(0, 24);
  let n = name,
    i = 2;
  while (used.has(n)) n = `${name}${i++}`;
  used.add(n);
  return n;
}

function tCall(msg, values) {
  const key = JSON.stringify(msg);
  if (!values.length) return `t(${key})`;
  const obj = values.map(([name, src]) => (src === name ? name : `${name}: ${src}`)).join(", ");
  return `t(${key}, { ${obj} })`;
}

/** Expressions that are plainly strings or numbers, safe to interpolate. */
function isScalarExpr(e) {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e))
    e = e.expression;
  if (
    ts.isStringLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    ts.isTemplateExpression(e)
  )
    return true;
  const text = e.getText();
  if (/<|=>|\?|&&|\|\|/.test(text)) return false;
  if (ts.isIdentifier(e)) {
    return (
      !/^(children|icon|Icon|node|content|element|badge|action|actions|extra|footer|header|trailing|leading|label|title|body|right|left|chip|pill|tag|addon|slot|render|button|link|status|meta|aside|hint|description|subtitle|sub|caption)$/i.test(
        e.text,
      ) && !/^[A-Z]/.test(e.text)
    );
  }
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
    const last = ts.isPropertyAccessExpression(e) ? e.name.text : "";
    return !/^(children|icon|Icon|node|content|element|render|label|title|body|description|hint|subtitle|caption|badge)$/.test(
      last,
    );
  }
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText();
    return /(format|Format|round|toFixed|toLocaleString|String|Number|peso|Peso|php|Php|money|Money|qty|Qty|kg|Kg|count|Count|abs|max|min|join|toUpperCase|toLowerCase|date|Date|time|Time|percent|Percent|fmt|Fmt|amount|Amount|Label|label|name|Name|plural|signed|Signed|weight|Weight|duration|Duration|ago|Ago|currency|Currency|num|Num|trim)/.test(
      callee,
    );
  }
  if (ts.isBinaryExpression(e))
    return (
      [
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken,
      ].includes(e.operatorToken.kind) &&
      isScalarExpr(e.left) &&
      isScalarExpr(e.right)
    );
  if (ts.isPrefixUnaryExpression(e)) return isScalarExpr(e.operand);
  return false;
}

function processFile(file, report) {
  const src = fs.readFileSync(file, "utf8");
  const tsx = file.endsWith(".tsx");
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  const covered = []; // [start, end) ranges already rewritten
  const isCovered = (n) => covered.some(([s, e]) => n.getStart() >= s && n.getEnd() <= e);
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const add = (node, start, end, text, kind, msg) => {
    if (SKIP.has(msg) || SKIP.has(`${rel}:${msg}`)) return false;
    if (shadowsT(node))
      report.push({
        file: rel,
        line: line(node),
        kind: "MANUAL:shadow",
        msg: "a local `t` hides the translate function here",
      });
    edits.push({ start, end, text });
    covered.push([start, end]);
    report.push({ file: rel, line: line(node), kind, msg });
    return true;
  };

  const isStr = (o) => ts.isStringLiteral(o) || ts.isNoSubstitutionTemplateLiteral(o);

  // Does a local variable or parameter named t hide the imported t here?
  function bindsT(name) {
    if (!name) return false;
    if (ts.isIdentifier(name)) return name.text === "t";
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
      return name.elements.some((e) => !ts.isOmittedExpression(e) && bindsT(e.name));
    return false;
  }
  function shadowsT(n) {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p) && p.parameters?.some((prm) => bindsT(prm.name))) return true;
      if (ts.isCatchClause(p) && p.variableDeclaration && bindsT(p.variableDeclaration.name))
        return true;
      if (
        (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) &&
        p.initializer &&
        ts.isVariableDeclarationList(p.initializer) &&
        p.initializer.declarations.some((d) => bindsT(d.name))
      )
        return true;
      const stmts =
        ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) ? p.statements : null;
      if (stmts) {
        for (const st of stmts) {
          if (
            ts.isVariableStatement(st) &&
            st.declarationList.declarations.some((d) => bindsT(d.name))
          )
            return true;
          if (ts.isFunctionDeclaration(st) && st.name?.text === "t") return true;
        }
      }
    }
    return false;
  }

  // Is this node inside a t("…") call already, a type, an import, or a comparison?
  function excludedContext(n) {
    for (let p = n.parent, c = n; p; c = p, p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode?.(p))
        return "import";
      if (ts.isTypeNode(p) && !ts.isExpressionWithTypeArguments(p)) return "type";
      if (ts.isCallExpression(p) && c !== p.expression) {
        const callee = p.expression.getText();
        if (/^(t|tx|textKey|i18n\.t|i18next\.t)$/.test(callee)) return "t";
        if (DATA_CALL.test(callee.replace(/\?\./g, "."))) return "datacall";
      }
      if (ts.isNewExpression(p) && c !== p.expression && DATA_CALL.test(p.expression.getText()))
        return "datacall";
      if (ts.isJsxAttribute(p)) {
        const name = p.name.getText();
        if (
          name === "className" ||
          name === "style" ||
          name.startsWith("data-") ||
          name === "key" ||
          name === "id"
        )
          return "attr";
      }
      if (ts.isPropertyAssignment(p) && c === p.initializer) {
        const name = p.name.getText().replace(/['"]/g, "");
        if (DATA_PROP.test(name)) return "dataprop";
      }
      if (ts.isPropertyAssignment(p) && c === p.name) return "propname";
      // A list handed to a function (choices([...]), new Set([...])) or
      // searched (.includes) holds values, not text.
      if (ts.isArrayLiteralExpression(p) && c === n) {
        const up = p.parent;
        if ((ts.isCallExpression(up) || ts.isNewExpression(up)) && up.arguments?.includes(p))
          return "dataarray";
        if (
          ts.isPropertyAccessExpression(up) &&
          /^(includes|indexOf|lastIndexOf|find|findIndex|some|every|filter|has)$/.test(up.name.text)
        )
          return "dataarray";
      }
      if (ts.isNewExpression(p) && c !== p.expression) return "new";
      // const OTHER = "Other": a one-word constant is a value to compare with.
      if (
        ts.isVariableDeclaration(p) &&
        c === p.initializer &&
        c === n &&
        isStr(n) &&
        /^[A-Z][A-Z0-9_]*$/.test(p.name.getText()) &&
        !/\s/.test(n.text.trim())
      )
        return "constant";
      if (ts.isElementAccessExpression(p) && c === p.argumentExpression) return "index";
      if (
        ts.isBinaryExpression(p) &&
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.InKeyword,
        ].includes(p.operatorToken.kind)
      )
        return "compare";
      if (ts.isCaseClause(p) && c === p.expression) return "compare";
      if (ts.isEnumMember(p)) return "enum";
      if (ts.isTaggedTemplateExpression(p)) return "tagged";
      // Stop climbing at statements and functions.
      if (
        ts.isStatement(p) ||
        ts.isFunctionLike(p) ||
        ts.isJsxElement(p) ||
        ts.isJsxSelfClosingElement(p) ||
        ts.isJsxFragment(p)
      ) {
        if (ts.isJsxSelfClosingElement(p) || ts.isJsxOpeningElement(p)) continue;
        break;
      }
    }
    return null;
  }

  // 1. Runs of JSX children: text plus simple values → one message.
  function visitChildren(children) {
    let run = [];
    const flush = () => {
      if (run.length) handleRun(run);
      run = [];
    };
    for (const ch of children) {
      if (ts.isJsxText(ch)) run.push(ch);
      else if (
        ts.isJsxExpression(ch) &&
        ch.expression &&
        isScalarExpr(ch.expression) &&
        !ts.isConditionalExpression(ch.expression)
      )
        run.push(ch);
      else if (ts.isJsxExpression(ch) && !ch.expression) {
        /* comment: ends nothing */
        run.push(ch);
      } else flush();
    }
    flush();
  }

  function handleRun(run) {
    // Trim pure-whitespace text, {" "} and comments at either end: they stay as written.
    const isBlank = (n) =>
      (ts.isJsxText(n) && jsxRendered(src.slice(n.pos, n.end)).trim() === "") ||
      (ts.isJsxExpression(n) &&
        (!n.expression || (ts.isStringLiteral(n.expression) && n.expression.text.trim() === "")));
    while (run.length && isBlank(run[0])) run.shift();
    while (run.length && isBlank(run[run.length - 1])) run.pop();
    if (!run.length) return;
    if (run.some((n) => ts.isJsxExpression(n) && !n.expression)) return; // comment inside: leave it
    const used = new Set();
    let msg = "";
    const values = [];
    for (const n of run) {
      if (ts.isJsxText(n)) msg += jsxRendered(src.slice(n.pos, n.end));
      else {
        let e = n.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) msg += e.text;
        else {
          const name = placeholderName(e, used);
          msg += `{{${name}}}`;
          values.push([name, e.getText()]);
        }
      }
    }
    const textOnly = msg.replace(/\{\{\w+\}\}/g, "");
    if (!/[A-Za-z]{2}/.test(textOnly)) return;
    const core = msg.trim();
    // Whitespace at either end: a newline-led run JSX drops anyway, so it
    // stays as written; a same-line space is rendered, so it becomes {" "}.
    const first = run[0],
      lastN = run[run.length - 1];
    let start = first.getStart(),
      end = lastN.getEnd();
    let out = `{${tCall(core, values)}}`;
    if (ts.isJsxText(first)) {
      const ws = src.slice(first.pos, first.end).match(/^\s*/)[0];
      if (/[\r\n]/.test(ws)) start = first.pos + ws.length;
      else {
        start = first.pos;
        if (ws) out = `{" "}` + out;
      }
    }
    if (ts.isJsxText(lastN)) {
      const ws = src.slice(lastN.pos, lastN.end).match(/\s*$/)[0];
      if (/[\r\n]/.test(ws)) end = lastN.end - ws.length;
      else {
        end = lastN.end;
        if (ws) out = out + `{" "}`;
      }
    }
    add(first, start, end, out, "jsx", core);
  }

  function templateMessage(tpl, used = new Set()) {
    let msg = tpl.head.text;
    const values = [];
    for (const span of tpl.templateSpans) {
      const e = span.expression;
      if (ts.isConditionalExpression(e) || (/\?|&&|\|\|/.test(e.getText()) && !isScalarExpr(e)))
        return null;
      const name = placeholderName(e, used);
      msg += `{{${name}}}` + span.literal.text;
      values.push([name, e.getText()]);
    }
    return { msg, values };
  }

  /** "a" + b + "c": the operands, left to right. */
  function plusOperands(n) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return [...plusOperands(n.left), ...plusOperands(n.right)];
    if (
      ts.isParenthesizedExpression(n) &&
      ts.isBinaryExpression(n.expression) &&
      n.expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    )
      return plusOperands(n.expression);
    return [n];
  }
  /** In "a" + x, x can't be an element (it would show as [object Object]), so
   *  any value is fine to fill in, unless it picks between texts itself. */
  function concatValue(o) {
    let e = o;
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e))
      e = e.expression;
    if (ts.isConditionalExpression(e)) return false;
    if (
      ts.isBinaryExpression(e) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(e.operatorToken.kind)
    )
      return false;
    let texty = false;
    (function v(x) {
      if (isStr(x) && looksLikeText(x.text)) texty = true;
      if (!texty && !ts.isFunctionLike(x)) ts.forEachChild(x, v);
    })(e);
    return !texty;
  }

  /** One message from a concatenation, or null if a part isn't a plain value. */
  function concatMessage(ops) {
    const used = new Set();
    let msg = "";
    const values = [];
    for (const o of ops) {
      if (isStr(o)) msg += o.text;
      else if (ts.isTemplateExpression(o)) {
        const tm = templateMessage(o, used);
        if (!tm) return null;
        msg += tm.msg;
        values.push(...tm.values);
      } else if (concatValue(o)) {
        const name = placeholderName(o, used);
        msg += `{{${name}}}`;
        values.push([name, o.getText()]);
      } else return null;
    }
    return { msg, values };
  }

  function visit(n) {
    if (isCovered(n)) return;
    // "Worked out from … " + "… of Service.": one message, not three.
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      const ops = plusOperands(n);
      const texty = ops.some((o) => isStr(o) && /[A-Za-z]{2}/.test(o.text));
      if (
        texty &&
        (isStr(ops[0]) || isStr(ops[1]) || ts.isTemplateExpression(ops[0])) &&
        !excludedContext(n)
      ) {
        const cm = concatMessage(ops);
        if (cm) {
          const textOnly = cm.msg.replace(/\{\{\w+\}\}/g, " ");
          if (looksLikeText(textOnly) && !looksLikeClasses(textOnly)) {
            const kind = `concat:${ts.SyntaxKind[n.parent.kind]}`;
            if (add(n, n.getStart(), n.getEnd(), tCall(cm.msg, cm.values), kind, cm.msg)) return;
          } else if (!looksLikeText(textOnly)) {
            ts.forEachChild(n, visit);
            return;
          }
        }
      }
    }
    // A <style> or <script> holds code, not words.
    if (ts.isJsxElement(n) && /^(style|script)$/.test(n.openingElement.tagName.getText())) return;
    if (tsx && (ts.isJsxElement(n) || ts.isJsxFragment(n))) {
      visitChildren(n.children);
    }
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer)) {
      const name = n.name.getText();
      const v = decodeEntities(n.initializer.text);
      if (TEXT_ATTR.test(name) && looksLikeText(v)) {
        add(
          n,
          n.initializer.getStart(),
          n.initializer.getEnd(),
          `{${tCall(v, [])}}`,
          `attr:${name}`,
          v,
        );
        return;
      }
    }
    if (
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
      !ts.isJsxAttribute(n.parent)
    ) {
      const v = n.text;
      if (
        looksLikeText(v) &&
        !excludedContext(n) &&
        !ts.isModuleDeclaration(n.parent) &&
        !ts.isExternalModuleReference(n.parent)
      ) {
        const p = n.parent;
        let kind = ts.SyntaxKind[p.kind];
        if (ts.isPropertyAssignment(p)) kind = `prop:${p.name.getText()}`;
        if (ts.isCallExpression(p)) kind = `call:${p.expression.getText().slice(-30)}`;
        // Words only: a one-word lowercase value is most likely data.
        if (!/^[a-z]+$/.test(v.trim())) add(n, n.getStart(), n.getEnd(), tCall(v, []), kind, v);
      }
    }
    if (ts.isTemplateExpression(n) && !excludedContext(n)) {
      const tm = templateMessage(n);
      if (tm) {
        const textOnly = tm.msg.replace(/\{\{\w+\}\}/g, " ");
        if (
          looksLikeText(textOnly) &&
          /[A-Za-z]{2,}\s+[A-Za-z]|[A-Z][a-z]+/.test(textOnly) &&
          !looksLikeClasses(textOnly) &&
          !/^[\s:/?=&.#-]*$/.test(textOnly)
        ) {
          const p = n.parent;
          let kind = `tpl:${ts.SyntaxKind[p.kind]}`;
          if (ts.isPropertyAssignment(p)) kind = `tpl:prop:${p.name.getText()}`;
          if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) {
            const an = p.parent.name.getText();
            if (
              an === "className" ||
              an === "key" ||
              an.startsWith("data-") ||
              an === "style" ||
              an === "id" ||
              an === "href" ||
              an === "to" ||
              an === "src"
            ) {
              ts.forEachChild(n, visit);
              return;
            }
            kind = `tpl:attr:${an}`;
          }
          if (add(n, n.getStart(), n.getEnd(), tCall(tm.msg, tm.values), kind, tm.msg)) return;
        }
      } else {
        const raw = n.getText();
        if (/[A-Za-z]{3,} [A-Za-z]{2,}/.test(raw.replace(/\$\{[^}]*\}/g, "")))
          report.push({
            file: rel,
            line: line(n),
            kind: "MANUAL:template",
            msg: raw.slice(0, 160),
          });
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);

  if (!edits.length) return;
  const alreadyImported = sf.statements.some(
    (st) =>
      ts.isImportDeclaration(st) &&
      /(^|\/)i18n$/.test(st.moduleSpecifier.text) &&
      /\bt\b/.test(st.importClause?.getText() ?? ""),
  );
  if (!alreadyImported) {
    let spec = path.relative(path.dirname(file), I18N_MODULE).split(path.sep).join("/");
    if (!spec.startsWith(".")) spec = "./" + spec;
    const imports = sf.statements.filter((st) => ts.isImportDeclaration(st));
    const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
    edits.push({
      start: at,
      end: at,
      text: imports.length ? `\nimport { t } from "${spec}";` : `import { t } from "${spec}";\n`,
    });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  if (!dry) fs.writeFileSync(file, out);
}

const files = (fileArgs.length ? fileArgs.map((f) => path.resolve(f)) : walk(SRC)).filter(
  (f) => !SKIP_FILES.has(path.relative(ROOT, f).split(path.sep).join("/")),
);
const report = [];
for (const f of files) processFile(f, report);
if (reportAt) fs.writeFileSync(reportAt, JSON.stringify(report, null, 1));
const kinds = {};
for (const r of report)
  kinds[r.kind.split(":").slice(0, 2).join(":")] =
    (kinds[r.kind.split(":").slice(0, 2).join(":")] || 0) + 1;
console.log(`${report.length} strings in ${new Set(report.map((r) => r.file)).size} files`);
console.log(
  Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n"),
);
