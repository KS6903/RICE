import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { notificationService, type AppNotification } from "../../services/NotificationService";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Bell in the header: unread count from /auth/me (already polled), and the
 *  list itself fetched only while the panel is open. */
export default function NotificationBell() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unread = user?.notifications_unread ?? 0;

  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationService.list(),
    enabled: open,
    // Override the client's 5-minute default: this must refetch every time
    // the panel opens, not just once per cache window, or new notices are
    // invisible until a full page reload wipes the cache.
    staleTime: 0,
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => notificationService.markRead(ids),
    onSuccess: (result, ids) => {
      // Update the badge now; the next /auth/me poll confirms it.
      if (user) {
        const remaining = ids ? Math.max(0, unread - result.updated) : 0;
        setUser({ ...user, notifications_unread: remaining });
      }
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Close on outside-click / Escape, the same pattern as LocationPicker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Platform admins belong to no tenant, so they have no tenant notices.
  if (!user || !user.company_id) return null;

  const openNotice = (notice: AppNotification) => {
    if (!notice.read) markRead.mutate([notice.id]);
    if (notice.link) {
      setOpen(false);
      navigate(notice.link);
    }
  };

  const items = list.data?.items ?? [];

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative h-9 w-9 grid place-items-center rounded-xl glass text-secondary hover:text-primary transition-colors"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        data-testid="notification-bell"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-[18px] text-center shadow"
            aria-hidden
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] z-50 bg-white dark:bg-slate-900 rounded-xl shadow-2xl ring-1 ring-soft overflow-hidden"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-soft">
            <span className="text-xs font-bold uppercase tracking-wide text-secondary">
              Notifications
            </span>
            <button
              type="button"
              onClick={() => markRead.mutate(undefined)}
              disabled={unread === 0 || markRead.isPending}
              className="inline-flex items-center gap-1 text-xs font-semibold link disabled:opacity-40 disabled:cursor-default"
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {list.isLoading ? (
              <div className="p-4 space-y-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-12 rounded-lg" />
                ))}
              </div>
            ) : list.isError ? (
              <p className="p-4 text-sm text-secondary">
                Notifications couldn't load. Try again in a moment.
              </p>
            ) : items.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm font-semibold text-primary">You're all caught up</p>
                <p className="text-xs text-secondary mt-1">
                  Reminders about your plan, invoices and scheduled reports show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotice(n)}
                      className="w-full text-left px-4 py-3 flex gap-3 hover:bg-[rgb(var(--ink)/0.04)] transition-colors"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-emerald-500"}`}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span
                          className={`block text-sm ${n.read ? "text-secondary" : "font-semibold text-primary"}`}
                        >
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="block text-xs text-secondary mt-0.5 line-clamp-2">
                            {n.body}
                          </span>
                        )}
                        <span className="block text-[11px] text-muted mt-1">
                          {timeAgo(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
