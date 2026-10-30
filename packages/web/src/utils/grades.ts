// Grades are listed A to Z wherever a picker offers them: the palay grades a mill
// has (A, B, C, NFA1 and any it adds) and the grades milled rice is stocked under
// (MILLED_GRADES, kept in that order in InventoryMapper).
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Palay grades A to Z by code: "a" sits beside "A", and "NFA2" comes before "NFA10". */
export const sortGrades = <T extends { code: string }>(grades: T[]): T[] =>
  [...grades].sort((a, b) => collator.compare(a.code, b.code));
