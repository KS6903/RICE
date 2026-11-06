import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Crown, Eye, Globe, LayoutGrid, Rocket, Star, Zap } from "lucide-react";
import { adminService, type ReleaseStage } from "../../services/AdminService";
import { describeSection } from "../../components/RoleAccessPanel";
import Select from "../../components/Select";
import { t } from "../../i18n";

const STAGE_TEXT: Record<ReleaseStage, string> = {
  bossadmin: t("BossAdmin only"),
  enterprise: t("Enterprise"),
  pro: t("Pro and up"),
  basic: t("Basic and up"),
  everyone: t("Everyone"),
};

export function stageLabel(stage: ReleaseStage): string {
  return STAGE_TEXT[stage] ?? stage;
}

const STAGE_ICON: Record<ReleaseStage, typeof Eye> = {
  bossadmin: Eye,
  enterprise: Crown,
  pro: Zap,
  basic: Star,
  everyone: Globe,
};

/**
 * BossAdmin's directory of the app's pages (backend core/releases.py). Every
 * push to main reaches every mill at once, so a new page waits here: it starts
 * at "BossAdmin only", where you try it through "View as" in any mill, then
 * goes to Enterprise, Pro and up, Basic and up, and everyone, as you choose.
 * A single mill can also have a page on early or off, from its own page.
 */
export default function AdminPages() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-pages"],
    queryFn: () => adminService.getPages(),
  });
  const save = useMutation({
    mutationFn: ({ section, stage }: { section: string; stage: ReleaseStage }) =>
      adminService.setPageStage(section, stage),
    onSuccess: (next) => qc.setQueryData(["admin-pages"], next),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <LayoutGrid size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">{t("Pages")}</h2>
          <p className="text-sm text-secondary">{t("Who gets each page of the app, and when.")}</p>
        </div>
      </div>

      <div className="card space-y-2 text-sm text-secondary">
        <p>
          {t(
            "A new page starts at BossAdmin only: open any mill with View as to try it on real data. Then move it on, one stage at a time or straight to everyone. A page a mill doesn't get is hidden there and refused by the server.",
          )}
        </p>
        <ol className="flex flex-wrap gap-2 pt-1">
          {(data?.stages ?? []).map((stage, i) => {
            const Icon = STAGE_ICON[stage] ?? Rocket;
            return (
              <li key={stage} className="badge-gray inline-flex items-center gap-1">
                <span className="tabular-nums text-muted">{i + 1}.</span>
                <Icon size={12} /> {stageLabel(stage)}
              </li>
            );
          })}
        </ol>
      </div>

      {save.isError && (
        <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
          {t("Couldn't save that change.")}
        </p>
      )}

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("Page")}</th>
              <th>{t("Released to")}</th>
              <th>{t("Turned on early for")}</th>
              <th>{t("Turned off for")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={4}>
                    <div className="skeleton h-4 w-1/2" />
                  </td>
                </tr>
              ))}
            {(data?.pages ?? []).map((page) => (
              <tr key={page.section}>
                <td className="font-medium text-primary">{describeSection(page.section).label}</td>
                <td className="w-60">
                  <Select
                    value={page.stage}
                    disabled={save.isPending}
                    onChange={(stage) =>
                      save.mutate({ section: page.section, stage: stage as ReleaseStage })
                    }
                    options={(data?.stages ?? []).map((s) => ({ value: s, label: stageLabel(s) }))}
                    aria-label={t("Who gets {{page}}", {
                      page: describeSection(page.section).label,
                    })}
                  />
                </td>
                <td className="text-xs">
                  <MillLinks mills={page.turned_on_for} />
                </td>
                <td className="text-xs">
                  <MillLinks mills={page.turned_off_for} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <p className="text-xs text-muted">
          {t("Always there for everyone: {{pages}}.", {
            pages: data.always_on.map((s) => describeSection(s).label).join(", "),
          })}
        </p>
      )}
    </div>
  );
}

function MillLinks({ mills }: { mills: { id: string; name: string }[] }) {
  if (mills.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {mills.map((m) => (
        <Link key={m.id} to={`/admin/tenants/${m.id}`} className="link">
          {m.name}
        </Link>
      ))}
    </span>
  );
}
