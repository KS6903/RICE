// Connecting storage sensors of any brand: each gets its own secret link to call. The Boss
// says which field holds what when the common names don't fit, and sees what it last sent.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import FieldCaption from "../FieldCaption";
import Select from "../Select";
import {
  savingsService,
  type Sensor,
  type SensorIn,
  type ZoneRow,
} from "../../services/SavingsService";
import { t } from "../../i18n";

const blank = (zoneId: string): SensorIn => ({
  name: "",
  zone_id: zoneId,
  humidity_field: "",
  temp_field: "",
  temp_unit: "c",
  humidity_offset: 0,
  temp_offset: 0,
  min_minutes: 15,
});

const toForm = (s: Sensor): SensorIn => ({
  name: s.name,
  zone_id: s.zone_id,
  humidity_field: s.humidity_field,
  temp_field: s.temp_field,
  temp_unit: s.temp_unit,
  humidity_offset: s.humidity_offset,
  temp_offset: s.temp_offset,
  min_minutes: s.min_minutes,
});

function SensorForm({
  value,
  zones,
  onChange,
}: {
  value: SensorIn;
  zones: ZoneRow[];
  onChange: (next: SensorIn) => void;
}) {
  const set = (change: Partial<SensorIn>) => onChange({ ...value, ...change });
  const number = (
    name: "humidity_offset" | "temp_offset" | "min_minutes",
    label: string,
    min?: number,
  ) => (
    <FieldCaption label={label}>
      <input
        className="input"
        type="number"
        min={min}
        value={value[name]}
        onChange={(e) => set({ [name]: Number(e.target.value) })}
      />
    </FieldCaption>
  );
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <FieldCaption label={t("Sensor name")}>
        <input
          className="input"
          maxLength={100}
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </FieldCaption>
      <FieldCaption label={t("Zone")}>
        <Select
          value={value.zone_id}
          onChange={(v) => set({ zone_id: v })}
          options={zones.map((z) => ({ value: z.id, label: z.name }))}
        />
      </FieldCaption>
      <FieldCaption label={t("Humidity field")}>
        <input
          className="input"
          placeholder={t("Automatic")}
          value={value.humidity_field}
          onChange={(e) => set({ humidity_field: e.target.value })}
        />
      </FieldCaption>
      <FieldCaption label={t("Temperature field")}>
        <input
          className="input"
          placeholder={t("Automatic")}
          value={value.temp_field}
          onChange={(e) => set({ temp_field: e.target.value })}
        />
      </FieldCaption>
      <FieldCaption label={t("Temperature in")}>
        <Select
          value={value.temp_unit}
          onChange={(v) => set({ temp_unit: v as "c" | "f" })}
          options={[
            { value: "c", label: "°C" },
            { value: "f", label: "°F" },
          ]}
        />
      </FieldCaption>
      {number("humidity_offset", t("Correct humidity by"))}
      {number("temp_offset", t("Correct temperature by"))}
      {number("min_minutes", t("Keep a reading every (minutes)"), 1)}
    </div>
  );
}

function LinkNotice({ link }: { link: string }) {
  const full = `${window.location.origin}${link}`;
  return (
    <div className="rounded-lg bg-[rgb(var(--ink)/0.05)] p-3 text-sm space-y-2">
      <p className="font-medium text-primary">
        {t("Copy this link now. It won't be shown again.")}
      </p>
      <code className="block break-all text-xs text-primary">{full}</code>
      <p className="text-secondary">
        {t(
          "Put it in the sensor's web address, webhook or HTTP setting. It can send the reading in the address, like ?humidity=68&temperature=27, or as JSON or a form.",
        )}
      </p>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void navigator.clipboard?.writeText(full)}
      >
        {t("Copy")}
      </button>
    </div>
  );
}

function SensorRow({
  sensor,
  zones,
  onSaved,
}: {
  sensor: Sensor;
  zones: ZoneRow[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SensorIn | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const zone = zones.find((z) => z.id === sensor.zone_id);
  const save = useMutation({
    mutationFn: (body: SensorIn) => savingsService.updateSensor(sensor.id, body),
    onSuccess: () => {
      setForm(null);
      onSaved();
    },
  });
  const renew = useMutation({
    mutationFn: () => savingsService.newSensorLink(sensor.id),
    onSuccess: (s) => setLink(s.link ?? null),
  });
  const remove = useMutation({
    mutationFn: () => savingsService.deleteSensor(sensor.id),
    onSuccess: onSaved,
  });
  return (
    <div className="space-y-3 border-t border-soft pt-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-primary">
            {sensor.name}
            {zone && <span className="font-normal text-secondary"> · {zone.name}</span>}
          </p>
          <p className="text-secondary">
            {sensor.last_read_at
              ? t("Last kept {{when}}: {{humidity}}% humidity, {{temp}} °C", {
                  when: format(new Date(sensor.last_read_at), "MMM d, h:mm a"),
                  humidity: sensor.last_humidity_pct ?? "—",
                  temp: sensor.last_temp_c ?? "—",
                })
              : sensor.last_seen_at
                ? t(
                    "It called, but no humidity or temperature could be read. Set the fields below.",
                  )
                : t("Nothing received yet.")}
          </p>
          {sensor.last_payload && (
            <p className="mt-1 break-all text-xs text-muted">
              {t("Last sent: {{payload}}", { payload: sensor.last_payload.slice(0, 300) })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setForm(form ? null : toForm(sensor))}
          >
            {t("Edit")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={renew.isPending}
            onClick={() => renew.mutate()}
          >
            {t("New link")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("Remove")}
          </button>
        </div>
      </div>
      {link && <LinkNotice link={link} />}
      {form && (
        <div className="space-y-3">
          <SensorForm value={form} zones={zones} onChange={setForm} />
          <button
            type="button"
            className="btn-primary"
            disabled={!form.name.trim() || save.isPending}
            onClick={() => save.mutate(form)}
          >
            {t("Save")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SensorsSection({ zones }: { zones: ZoneRow[] }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["savings-sensors"], queryFn: savingsService.sensors });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["savings-sensors"] });
    void queryClient.invalidateQueries({ queryKey: ["savings-warehouse"] });
  };
  const [form, setForm] = useState<SensorIn | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (body: SensorIn) => savingsService.addSensor(body),
    onSuccess: (s) => {
      setForm(null);
      setLink(s.link ?? null);
      refresh();
    },
  });
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold text-primary">{t("Sensors")}</h3>
        <p className="text-sm text-secondary">
          {t(
            "Any brand that can call a web address will do. Readings count just like typed ones. Leave the fields on Automatic, and if a sensor's reading isn't picked up, see what it last sent and name its fields.",
          )}
        </p>
      </div>
      {(data ?? []).map((sensor) => (
        <SensorRow key={sensor.id} sensor={sensor} zones={zones} onSaved={refresh} />
      ))}
      {link && <LinkNotice link={link} />}
      {form ? (
        <div className="space-y-3">
          <SensorForm value={form} zones={zones} onChange={setForm} />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!form.name.trim() || !form.zone_id || add.isPending}
              onClick={() => add.mutate(form)}
            >
              {t("Add sensor")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          disabled={zones.length === 0}
          onClick={() => {
            setLink(null);
            setForm(blank(zones[0]?.id ?? ""));
          }}
        >
          {t("Connect a sensor")}
        </button>
      )}
      {zones.length === 0 && (
        <p className="text-sm text-secondary">{t("Add a storage zone first.")}</p>
      )}
    </section>
  );
}
