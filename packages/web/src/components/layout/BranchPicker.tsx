import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import Select from "../Select";
import { authService } from "../../services/AuthService";
import { branchesService } from "../../services/BranchesService";
import { useAuthStore } from "../../stores/authStore";
import { useBranchStore } from "../../stores/branchStore";

const ALL = "all";

/**
 * The top bar's branch picker, for the Boss and Admins of a mill with more than
 * one branch: one branch at a time, or all of them added up. It opens on the
 * user's default view (the main branch, unless they chose another), and "Open
 * here by default" makes the current one the default on every device. The
 * choice goes with every request (api.ts), and switching reloads what's on the
 * screen for it.
 */
export default function BranchPicker() {
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
        qc.invalidateQueries();
      }
      return;
    }
    const known = view === ALL || branches.some((b) => b.id === view);
    if (owner === user.id && known) return;
    setView(defaultView, user.id);
    // What loaded before the picker opened was for every branch.
    qc.invalidateQueries();
  }, [user, chooses, isSuccess, several, branches, view, owner, defaultView, setView, qc]);

  if (!user || !chooses || !several || view === null) return null;

  const options = [
    ...branches.map((b) => ({
      value: String(b.id),
      label: b.is_main_branch ? `${b.name} (main)` : String(b.name),
    })),
    { value: ALL, label: "All branches" },
  ];
  // With every branch showing, new records go to the user's own branch.
  const home = branches.find((b) => b.id === user.branch_id);

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Building2 size={15} className="hidden sm:block shrink-0 text-muted" aria-hidden />
      <Select
        aria-label="Branch"
        value={view}
        onChange={(v) => {
          setView(v, user.id);
          qc.invalidateQueries();
        }}
        options={options}
        className="max-w-[9rem] sm:max-w-[13rem]"
        title={
          view === ALL && home
            ? `Every branch added up. New records go to ${home.name}.`
            : undefined
        }
      />
      {view !== defaultView && (
        <button
          type="button"
          className="hidden md:inline text-xs font-semibold text-secondary hover:text-primary whitespace-nowrap"
          disabled={save.isPending}
          onClick={() => save.mutate(view)}
        >
          Open here by default
        </button>
      )}
    </div>
  );
}
