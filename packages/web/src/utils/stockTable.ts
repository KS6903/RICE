/** A stock table's cell. A phone can't spare 16px a side of every cell, and a cell may
 *  wrap there (the base styles keep a table's text on one line). */
export const STOCK_CELL = "px-3 py-3 sm:px-4 max-sm:!whitespace-normal";

/** What a phone shows in small print under the variety, in place of the columns it
 *  has no room for: the grade, and the branch and warehouse where there are several. */
export const stockDetails = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");
