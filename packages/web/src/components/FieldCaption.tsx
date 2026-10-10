/**
 * A small caption above a line-item input. Line items (purchase, batch and
 * order rows) used to rely on placeholders alone, which vanish as soon as
 * something is typed, leaving a row of unlabeled numbers.
 */
export default function FieldCaption({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className ? `block ${className}` : "block"}>
      <span className="block mb-1 text-xs font-medium text-secondary">{label}</span>
      {children}
    </label>
  );
}
