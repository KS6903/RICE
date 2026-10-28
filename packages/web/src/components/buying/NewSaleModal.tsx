// "New Sale" on a Buy & mill page: a sales order for this page's goods only
// (palay, rice or by-products). It saves through the same endpoint as the
// Sales page, so the order shows there too and can be invoiced as usual.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CUSTOMER_TYPES } from "@rice-mill/shared";
import { salesService } from "../../services/SalesService";
import { paddyService } from "../../services/PaddyService";
import { useAuthStore } from "../../stores/authStore";
import { MILLED_GRADES } from "../../mappers/InventoryMapper";
import { useByproductKinds } from "../../hooks/useByproductKinds";
import Modal from "../Modal";
import Select from "../Select";
import DatePicker from "../DatePicker";
import FieldCaption from "../FieldCaption";
import QuickAdd from "../QuickAdd";
import { peso } from "./money";
import { GOODS, SALE_ITEM_TYPE, gradeLabel, type TradeKind } from "./trade";
import { t } from "../../i18n";

type Line = {
  variety_id: string;
  grade_name: string;
  byproduct_type: string;
  quantity_kg: string;
  unit_price_per_kg: string;
};

const newLine = (kind: TradeKind): Line => ({
  variety_id: "",
  grade_name: kind === "rice" ? "Straight Mill Rice" : "",
  byproduct_type: kind === "byproduct" ? "ipa" : "",
  quantity_kg: "",
  unit_price_per_kg: "",
});

type ApiError = { response?: { data?: { detail?: unknown; code?: string } } };
const apiError = (error: unknown) => {
  const data = (error as ApiError)?.response?.data;
  return {
    message:
      typeof data?.detail === "string" ? data.detail : t("The sale couldn't be saved. Try again."),
    code: data?.code,
  };
};

const TITLE: Record<TradeKind, string> = {
  palay: t("New Palay Sale"),
  rice: t("New Rice Sale"),
  byproduct: t("New By-product Sale"),
};

export default function NewSaleModal({ kind, onClose }: { kind: TradeKind; onClose: () => void }) {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canApprove = role === "owner" || role === "admin";

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["customers"],
    queryFn: () => salesService.listCustomers(false),
  });
  const { data: varieties = [] } = useQuery<any[]>({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
    enabled: kind !== "byproduct",
  });
  const { data: grades = [] } = useQuery<any[]>({
    queryKey: ["grades"],
    queryFn: () => paddyService.listGrades(),
    enabled: kind === "palay",
  });
  // Ipa, darak, binlid and the ones the mill added on Stock > Catalog.
  const { active: byproductKinds } = useByproductKinds();

  const gradeOptions = useMemo(
    () =>
      kind === "rice"
        ? MILLED_GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))
        : [
            { value: "", label: t("No grade") },
            ...grades.map((g: any) => ({ value: g.code, label: g.code })),
          ],
    [kind, grades],
  );

  const [form, setForm] = useState({
    customer_id: "",
    order_date: format(new Date(), "yyyy-MM-dd"),
    remarks: "",
    items: [newLine(kind)],
  });
  const setLine = (idx: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, items: f.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));

  const save = useMutation({
    mutationFn: (approve: boolean) =>
      salesService.createOrder({
        customer_id: form.customer_id,
        order_date: form.order_date,
        discount_pct: "0",
        remarks: form.remarks || null,
        approve_over_limit: approve || undefined,
        items: form.items.map((l) => ({
          item_type: SALE_ITEM_TYPE[kind],
          variety_id: kind === "byproduct" ? null : l.variety_id,
          grade_name: kind === "byproduct" ? null : l.grade_name || null,
          byproduct_type: kind === "byproduct" ? l.byproduct_type : null,
          quantity_kg: l.quantity_kg,
          unit_price_per_kg: l.unit_price_per_kg,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      onClose();
    },
  });
  const error = save.isError ? apiError(save.error) : null;

  const totalKg = form.items.reduce((s, l) => s + (Number(l.quantity_kg) || 0), 0);
  const totalPeso = form.items.reduce(
    (s, l) => s + (Number(l.quantity_kg) || 0) * (Number(l.unit_price_per_kg) || 0),
    0,
  );
  const ready =
    !!form.customer_id &&
    form.items.every((l) => Number(l.quantity_kg) > 0 && l.unit_price_per_kg !== "");

  return (
    <Modal
      open
      size="xl"
      title={TITLE[kind]}
      subtitle={t(
        "A sales order for {{GOODS}}. It also shows on the Sales page, ready to invoice.",
        { GOODS: GOODS[kind] },
      )}
      onClose={onClose}
      testId="new-sale"
      footer={
        <>
          <p className="mr-auto text-sm text-gray-600 dark:text-slate-300" data-testid="sale-total">
            {t("Total:")}{" "}
            <span className="font-semibold tabular-nums">
              {t("{{totalKg}} kg", { totalKg: totalKg.toLocaleString() })}
            </span>
            {" · "}
            <span className="font-semibold tabular-nums">{peso(totalPeso)}</span>
          </p>
          <button onClick={onClose} className="btn-secondary">
            {t("Cancel")}
          </button>
          <button
            onClick={() => save.mutate(false)}
            className="btn-primary"
            disabled={save.isPending || !ready}
          >
            {save.isPending ? t("Saving…") : t("Save Sale")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                {t("Customer")}
              </label>
              <QuickAdd
                label={t("New customer")}
                endpoint="/sales/customers"
                queryKey={["customers"]}
                fields={[
                  { key: "name", label: t("Name"), required: true, full: true },
                  {
                    key: "customer_type",
                    label: t("Type"),
                    type: "select",
                    options: CUSTOMER_TYPES.map((c) => ({ value: c.value, label: t(c.label) })),
                    default: "wholesaler",
                  },
                  { key: "phone", label: t("Phone") },
                ]}
                onCreated={(c) => setForm((f) => ({ ...f, customer_id: c.id }))}
              />
            </div>
            <Select
              aria-label={t("Customer")}
              placeholder={t("Choose a customer")}
              value={form.customer_id}
              onChange={(v) => setForm((f) => ({ ...f, customer_id: v }))}
              options={customers.map((c: any) => ({ value: c.id, label: c.name }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-200">
              {t("Sale Date")}
            </label>
            <DatePicker
              aria-label={t("Sale date")}
              value={form.order_date}
              onChange={(v) => setForm((f) => ({ ...f, order_date: v }))}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-200">
              {t("Sale Items")}
            </p>
            <button
              onClick={() => setForm((f) => ({ ...f, items: [...f.items, newLine(kind)] }))}
              className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              {t("+ Add Item")}
            </button>
          </div>
          {form.items.map((item, idx) => (
            <div
              key={idx}
              className={`grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 dark:bg-slate-900/50 ${kind === "byproduct" ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}
            >
              {kind === "byproduct" ? (
                <FieldCaption label={t("By-product")} className="col-span-2 sm:col-span-1">
                  <Select
                    aria-label={t("By-product")}
                    value={item.byproduct_type}
                    onChange={(v) => setLine(idx, { byproduct_type: v })}
                    options={byproductKinds.map((k) => ({ value: k.code, label: k.name }))}
                  />
                </FieldCaption>
              ) : (
                <>
                  <FieldCaption label={t("Variety")}>
                    <Select
                      aria-label={t("Variety")}
                      placeholder={t("Variety")}
                      value={item.variety_id}
                      onChange={(v) => setLine(idx, { variety_id: v })}
                      options={varieties.map((v: any) => ({ value: v.id, label: v.code }))}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Grade")}>
                    <Select
                      aria-label={t("Grade")}
                      value={item.grade_name}
                      onChange={(v) => setLine(idx, { grade_name: v })}
                      options={gradeOptions}
                    />
                  </FieldCaption>
                </>
              )}
              <FieldCaption label={t("Weight (kg)")}>
                <input
                  className="input"
                  placeholder="kg"
                  type="number"
                  min="0"
                  value={item.quantity_kg}
                  onChange={(e) => setLine(idx, { quantity_kg: e.target.value })}
                />
              </FieldCaption>
              <FieldCaption label={t("Price per kg (₱)")}>
                <input
                  className="input"
                  placeholder={t("₱/kg")}
                  type="number"
                  min="0"
                  value={item.unit_price_per_kg}
                  onChange={(e) => setLine(idx, { unit_price_per_kg: e.target.value })}
                />
              </FieldCaption>
            </div>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/60 dark:bg-rose-950/30"
          >
            <p className="text-sm text-rose-700 dark:text-rose-300">{error.message}</p>
            {error.code === "over_credit_limit" && canApprove && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => save.mutate(true)}
                disabled={save.isPending}
              >
                {t("Approve over the limit")}
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
