import { describe, expect, it } from "vitest";
import { encodeCsvCell, encodeCsvRow } from "./csv";

describe("CSV encoding", () => {
  it.each(["=2+2", "+SUM(A1:A2)", "-1+1", "@cmd", '  =HYPERLINK("x")'])(
    "neutralizes spreadsheet formula input %s",
    (value) => {
      const encoded = encodeCsvCell(value);
      const decoded = encoded.startsWith('"') ? encoded.slice(1, -1).replace(/""/g, '"') : encoded;
      expect(decoded).toBe(`'${value}`);
    },
  );

  it("preserves numeric values and correctly escapes CSV syntax", () => {
    expect(encodeCsvRow([42, 'Rice, "Premium"', "safe"])).toBe('42,"Rice, ""Premium""",safe');
  });
});
