type Props = {
  color: string | null | undefined;
  label?: string;
  size?: number;
  className?: string;
};

/** Tiny reserved-color chip — used in tables and pickers so the user can
 *  visually confirm which color is claimed by which agent / miller. */
export default function ColorSwatch({ color, label, size = 14, className }: Props) {
  const c = color || "#cbd5e1";
  return (
    <span
      className={`inline-block rounded-md ring-1 ring-slate-300/60 dark:ring-slate-600/60 shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size, backgroundColor: c }}
      title={label ? `${label} — ${c}` : c}
      aria-label={label ? `Color ${c} reserved for ${label}` : `Color ${c}`}
      data-testid="color-swatch"
      data-color={c.toLowerCase()}
    />
  );
}
