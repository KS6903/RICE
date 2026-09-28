import { Link } from "react-router-dom";
import React from "react";

/** Minimal, dependency-free Markdown renderer for the legal pages.
 *
 *  Supports exactly what those documents use: headings, paragraphs, bullet
 *  lists, pipe tables, horizontal rules, bold, and links. Everything else
 *  renders as plain text.
 *
 *  It builds React elements and never touches `dangerouslySetInnerHTML`, so
 *  raw HTML in a document is displayed, not executed. That matters more here
 *  than anywhere else in the app: these pages are public, unauthenticated, and
 *  are the one surface whose exact wording we may later have to stand behind.
 */

type Props = {
  source: string;
  /** Prepended to heading ids. Several documents share one page, and they
   *  reuse headings like "Definitions", so their ids would otherwise collide. */
  idPrefix?: string;
};

const BOLD_OR_LINK = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  return text
    .split(BOLD_OR_LINK)
    .filter(Boolean)
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={key} className="font-semibold text-primary">
            {part.slice(2, -2)}
          </strong>
        );
      }
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const [, label, href] = link;
        // Internal routes stay in the SPA; anything else opens safely.
        if (href.startsWith("/")) {
          return (
            <Link key={key} to={href} className="link">
              {label}
            </Link>
          );
        }
        const safe = /^(https?:|mailto:)/i.test(href);
        if (!safe) return <span key={key}>{label}</span>;
        return (
          <a key={key} href={href} className="link" target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        );
      }
      return <React.Fragment key={key}>{part}</React.Fragment>;
    });
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

export default function Markdown({ source, idPrefix }: Props) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trim() === "---") {
      out.push(<hr key={`hr-${i}`} className="my-8 border-soft" />);
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h-${i}`);
      const cls: Record<number, string> = {
        1: "text-2xl font-bold text-primary mt-2 mb-4",
        2: "text-lg font-bold text-primary mt-8 mb-2 scroll-mt-24",
        3: "text-base font-semibold text-primary mt-6 mb-2",
        4: "text-sm font-semibold text-secondary mt-4 mb-1",
      };
      const slug = heading[2]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const id = idPrefix ? `${idPrefix}-${slug}` : slug;
      const Tag = `h${Math.min(level + 1, 6)}` as unknown as keyof JSX.IntrinsicElements;
      out.push(
        <Tag key={`h-${i}`} id={id} className={cls[level]}>
          {content}
        </Tag>,
      );
      i += 1;
      continue;
    }

    // Pipe table: a header row, a separator row, then body rows.
    if (line.trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      out.push(
        <div key={`t-${i}`} className="my-5 overflow-x-auto rounded-2xl border border-soft">
          <table className="data-table">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{inline(h, `th-${i}-${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="align-top">
                      {inline(c, `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = j;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s+/, "");
        // Continuation lines are indented under the bullet.
        while (
          i + 1 < lines.length &&
          /^\s{2,}\S/.test(lines[i + 1]) &&
          !/^\s*[-*]\s+/.test(lines[i + 1])
        ) {
          item += ` ${lines[i + 1].trim()}`;
          i += 1;
        }
        items.push(item);
        i += 1;
      }
      out.push(
        <ul key={`ul-${i}`} className="my-3 space-y-1.5 pl-5 list-disc marker:text-emerald-500">
          {items.map((item, ii) => (
            <li key={ii} className="text-secondary leading-relaxed">
              {inline(item, `li-${i}-${ii}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraph: consume until a blank line or a block-level marker.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      lines[i].trim() !== "---" &&
      !lines[i].trim().startsWith("|")
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(
      <p key={`p-${i}`} className="my-3 text-secondary leading-relaxed">
        {inline(para.join(" "), `p-${i}`)}
      </p>,
    );
  }

  return <div className="max-w-none">{out}</div>;
}
