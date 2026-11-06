import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { Link } from "react-router-dom";
import { adminService } from "../../services/AdminService";
import { describeSection } from "../RoleAccessPanel";
import { stageLabel } from "../../pages/admin/AdminPages";
import Select from "../Select";
import { t } from "../../i18n";

/**
 * One mill's switches over the app's pages (backend core/releases.py): follow
 * the page's release stage, or turn it on early (a tester) or off for this mill
 * whatever the stage. Turning a page off closes it for everyone in the mill, in
 * the app and on the server.
 */
export default function TenantPagesCard({
  tenantId,
  overrides,
}: {
  tenantId: string;
  overrides: Record<string, "on" | "off">;
}) {
  const qc = useQueryClient();
  const { data: directory } = useQuery({
    queryKey: ["admin-pages"],
    queryFn: () => adminService.getPages(),
  });
  const save = useMutation({
    mutationFn: ({ section, value }: { section: string; value: "on" | "off" | "default" }) =>
      adminService.setTenantPage(tenantId, section, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant", tenantId] });
      qc.invalidateQueries({ queryKey: ["admin-pages"] });
    },
  });

  return (
    <div className="panel">
      <div className="px-6 py-4 border-b border-soft flex items-center gap-2">
        <LayoutGrid size={16} className="text-muted" />
        <h3 className="font-semibold text-primary">{t("Pages for this mill")}</h3>
        <Link to="/admin/pages" className="link ml-auto text-xs">
          {t("Release stages")}
        </Link>
      </div>
      <p className="px-6 pt-3 text-xs text-muted">
        {t(
          "Each page follows its release stage unless you turn it on early or off for this mill. Settings and the dashboard are always there.",
        )}
      </p>
      {save.isError && (
        <p className="px-6 pt-2 text-sm text-rose-600 dark:text-rose-400">
          {t("Couldn't save that change.")}
        </p>
      )}
      <ul className="divide-y divide-soft">
        {(directory?.pages ?? []).map((page) => {
          const value = overrides[page.section] ?? "default";
          return (
            <li key={page.section} className="px-6 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="font-medium text-primary min-w-36">
                {describeSection(page.section).label}
              </span>
              <span className="text-xs text-muted">{stageLabel(page.stage)}</span>
              <div className="ml-auto w-56">
                <Select
                  value={value}
                  disabled={save.isPending}
                  onChange={(v) =>
                    save.mutate({ section: page.section, value: v as "on" | "off" | "default" })
                  }
                  options={[
                    { value: "default", label: t("Follow its stage") },
                    { value: "on", label: t("On for this mill") },
                    { value: "off", label: t("Off for this mill") },
                  ]}
                  aria-label={t("{{page}} for this mill", {
                    page: describeSection(page.section).label,
                  })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
