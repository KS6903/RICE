import { Plus } from "lucide-react";

/**
 * What an empty list says to someone who has never used it: what the page is
 * for, the one thing to do first, and (optionally) what that leads to. Meant to
 * replace a bare "No … yet".
 */
export default function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  onAction,
  next,
}: {
  icon: React.ElementType;
  title: string;
  /** One or two sentences: what goes here and why it matters. */
  children: React.ReactNode;
  /** Button label for the first step; left out for users who can only view. */
  action?: string;
  onAction?: () => void;
  /** A short "after this…" line pointing at the next step in the mill's flow. */
  next?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md py-10 px-4 text-center">
      <div className="mx-auto h-12 w-12 rounded-xl bg-emerald-500/10 grid place-items-center">
        <Icon size={22} className="text-emerald-600 dark:text-emerald-400" />
      </div>
      <p className="mt-3 font-semibold text-primary">{title}</p>
      <p className="mt-1 text-sm text-secondary">{children}</p>
      {action && onAction && (
        <button type="button" onClick={onAction} className="btn-primary mt-4">
          <Plus size={16} /> {action}
        </button>
      )}
      {next && <p className="mt-3 text-xs text-muted">{next}</p>}
    </div>
  );
}
