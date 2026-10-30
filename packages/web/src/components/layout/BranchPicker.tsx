import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import Select from "../Select";
import { authService } from "../../services/AuthService";
import { branchesService } from "../../services/BranchesService";
import { useAuthStore } from "../../stores/authStore";
import { useBranchStore } from "../../stores/branchStore";
import { t } from "../../i18n";

const ALL = "all";

/** Load what's on the screen again, for the branch now chosen. A request still in
 *  flight was sent before it (a page that was opening when the picker did), and
 *  invalidating alone keeps it when the query has no data yet, so it's dropped first. */
function reloadForBranch(qc: QueryClient) {
  void qc.cancelQueries();
  void qc.invalidateQueries();
}

/**
 * The top bar's branch picker, for the Boss and Admins of a mill with more than
 * one branch: one branch at a time, or all of them added up. It opens on the
 * user's default view (the main branch, unless they chose another), and "Open
 * here by default" makes the current one the default on every device. The
 * choice goes with every request (api.ts), and switching reloads what's on the
 * screen for it.
 */
export default function BranchPicker({ className = "" }: { className?: string }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const view = useBranchStore((s) => s.view);
  const owner = useBranchStore((s) => s.owner);
  const setView = useBranchStore((s) => s.setView);
  const qc = useQueryClient();
  const chooses = user?.role === "owner" || user?.role === "admin";

  const { data: branches = [], isSuccess } = useQuery<any[]>({
    queryKey: ["branches"],
    queryFn: () => branchesService.list(),
    enabled: chooses,
  });
  const several = branches.length > 1;
  const main = branches.find((b) => b.is_main_branch) ?? branches[0];
  const saved = user?.branch_view_default ?? "main";
  const defaultView: string | null =
    saved === ALL ? ALL : branches.some((b) => b.id === saved) ? saved : (main?.id ?? null);

  const save = useMutation({
    mutationFn: (v: string) => authService.setBranchView(v === main?.id ? "main" : v),
    onSuccess: (res) => {
      if (user) setUser({ ...user, branch_view_default: res.branch_view_default });
    },
  });

  // Open on the default once per sign-in; drop the choice when the mill is
  // down to one branch, or for someone who doesn't pick.
  useEffect(() => {
    if (!user || (chooses && !isSuccess)) return;
    if (!chooses || !several) {
      if (view !== null) {
        setView(null, user.id);
        reloadForBranch(qc);
      }
      return;
    }
    const known = view === ALL || branches.some((b) => b.id === view);
    if (owner === user.id && known) return;
    setView(defaultView, user.id);
    // What loaded before the picker opened was for every branch.
    reloadForBranch(qc);
  }, [user, chooses, isSuccess, several, branches, view, owner, defaultView, setView, qc]);

  if (!user || !chooses || !several || view === null) return null;

  const options = [
    ...branches.map((b) => ({
      value: String(b.id),
      label: b.is_main_branch ? `${b.name} (main)` : String(b.name),
    })),
    { value: ALL, label: t("All branches") },
  ];
  // With every branch showing, new records go to the user's own branch.
  const home = branches.find((b) => b.id === user.branch_id);

  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      <Building2 size={15} className="hidden sm:block shrink-0 text-muted" aria-hidden />
      <Select
        aria-label={t("Branch")}
        value={view}
        onChange={(v) => {
          setView(v, user.id);
          reloadForBranch(qc);
        }}
        options={options}
        className="flex-1 min-w-0"
        title={
          view === ALL && home
            ? t("Every branch added up. New records go to {{name}}.", { name: home.name })
            : undefined
        }
      />
      {view !== defaultView && (
        <button
          type="button"
          className="shrink-0 text-xs font-semibold text-secondary hover:text-primary whitespace-nowrap"
          disabled={save.isPending}
          onClick={() => save.mutate(view)}
        >
          {t("Open here by default")}
        </button>
      )}
    </div>
  );
}
