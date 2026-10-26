import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { clsx } from "clsx";

/** Open/closed state for the sidebar on a phone or tablet. Following a link
 *  or pressing Escape closes it. */
export function useNavDrawer() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return { open, setOpen };
}

/** The sidebar's frame: docked beside the page from `lg` up, and below that a
 *  panel that slides in over the page, with a dimmed backdrop that closes it.
 *  While closed it's invisible too, so its links drop out of the tab order. */
export function NavDrawer({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        id="app-nav"
        className={clsx(
          "app-nav flex flex-col min-h-0 glass border-r border-soft",
          "fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none",
          "lg:relative lg:z-auto lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:visible lg:transition-none",
          // Solid enough to read over the page it covers.
          "max-lg:bg-[rgb(var(--surface-raised)/0.96)] max-lg:shadow-2xl",
          open ? "translate-x-0" : "-translate-x-full invisible",
          className,
        )}
      >
        {children}
      </aside>
    </>
  );
}

/** Opens the drawer; only shown below `lg`, where the sidebar is hidden. */
export function NavDrawerButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="lg:hidden -ml-1 h-10 w-10 shrink-0 grid place-items-center rounded-xl text-secondary hover:text-primary hover:bg-[rgb(var(--line)/0.45)] transition-colors"
      aria-label="Open menu"
      aria-controls="app-nav"
      aria-expanded={open}
    >
      <Menu size={20} />
    </button>
  );
}
