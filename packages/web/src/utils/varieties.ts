// Palay and rice have their own variety lists (NSIC Rc 222 and the rest; Dinorado
// and the rest). A variety a mill made before the split is "both" and stays on
// every page. The server sends one list with each variety's `kind`.
export type VarietyKind = "palay" | "rice";

/** The varieties a page offers: its own kind, and those marked for both. */
export const varietiesOf = (list: any[], kind: VarietyKind): any[] =>
  list.filter((v) => (v.kind ?? "rice") === kind || v.kind === "both");

/** What a picker shows: the code, and for a palay variety the other names it
 *  goes by ("NSIC Rc 222 (Tubigan 18, Triple Two)"). */
export const varietyLabel = (v: { kind?: string; code: string; name?: string }): string =>
  v.kind === "palay" && v.name && v.name !== v.code ? v.name : v.code;

/** The options for a variety picker, of one kind. */
export const varietyOptions = (list: any[], kind: VarietyKind) =>
  varietiesOf(list, kind).map((v) => ({ value: v.id as string, label: varietyLabel(v) }));
