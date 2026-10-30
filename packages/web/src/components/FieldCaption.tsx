/**
 * A small caption above a line-item input. Line items (purchase, batch and
 * order rows) used to rely on placeholders alone, which vanish as soon as
 * something is typed, leaving a row of unlabeled numbers.
 *
 * With `error`, the field is outlined in red and the notice sits under it (outside
 * the label, so the field's name stays what it was).
 */
export default function FieldCaption({
  label,
  className,
  error,
  children,
}: {
  label: string;
  className?: string;
  /** What the field needs from the user, shown once they have tried to save without it. */
  error?: string;
  children: React.ReactNode;
}) {
  const classes = [className, error ? "field-error" : ""].filter(Boolean).join(" ");
  return (
    <div className={classes || undefined}>
      <label className="block">
        <span className="block mb-1 text-xs font-medium text-secondary">{label}</span>
        {children}
      </label>
      {error && (
        <p
          data-testid="field-error"
          className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
