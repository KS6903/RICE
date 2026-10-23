import { clsx } from "clsx";

/**
 * A code-like value in a table (batch, order or licence number) in monospace.
 * A blank shows the tables' long dash in the normal font: in monospace the dash
 * gets one narrow character cell and reads as a short hyphen.
 */
export default function CodeValue({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  if (!value) return <>—</>;
  return <span className={clsx("font-mono text-xs", className)}>{value}</span>;
}
