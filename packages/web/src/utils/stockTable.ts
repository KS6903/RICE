const PAD = "px-3 py-3 sm:px-4";

/** A stock table's cell of text. A phone can't spare 16px a side of every cell, and the
 *  text may wrap there (the base styles keep a table's text on one line). */
export const STOCK_CELL = `${PAD} max-sm:!whitespace-normal`;

/** A cell of figures, which stay on one line however narrow the screen. */
export const STOCK_FIGURE = `${PAD} whitespace-nowrap`;

/** What a phone shows in small print under the variety, in place of the columns it
 *  has no room for: the grade, and the branch and warehouse where there are several. */
export const stockDetails = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");
