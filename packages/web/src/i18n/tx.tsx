import { Fragment, isValidElement, type ReactNode } from "react";
import { t } from ".";

// Marks where an element goes: a private-use character no text contains.
const MARK = "";
const MARKED = new RegExp(`${MARK}(\\w+)${MARK}`);

/** A sentence with elements in it (a name in bold, a link): t() for the words,
 *  and each {{name}} whose value is an element keeps that element in its place,
 *  wherever the language puts it.
 *
 *    tx("Your {{plan}} plan expires in {{count}} days.", { plan: <b>{name}</b>, count })
 */
export function tx(key: string, values: Record<string, unknown>): ReactNode {
  const elements: Record<string, ReactNode> = {};
  const plain: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    if (isValidElement(value)) {
      elements[name] = value;
      plain[name] = `${MARK}${name}${MARK}`;
    } else plain[name] = value;
  }
  return t(key, plain)
    .split(MARKED)
    .map((part, i) => (i % 2 ? <Fragment key={i}>{elements[part]}</Fragment> : part));
}
