import { useState } from "react";
import { Check } from "lucide-react";
import ColorSwatch from "./ColorSwatch";

export type CourierParty = {
  id: string;
  name: string;
  canva_color_hex: string | null;
};

type Props = {
  agents: CourierParty[];
  millers: CourierParty[];
  /** Currently-assigned courier: pass `{ kind, id }` or null when nothing is set. */
  current: { kind: "agent" | "miller"; id: string } | null;
  onPick: (pick: { kind: "agent" | "miller"; id: string } | null) => void;
  disabled?: boolean;
};

/** Inline picker that shows agents and millers side-by-side with their reserved
 *  colors. Clicking a row commits the choice; clicking the currently-selected
 *  row clears it. Used in the Order Delivery tab's "Assign courier" modal. */
export default function CourierPicker({ agents, millers, current, onPick, disabled }: Props) {
  const [tab, setTab] = useState<"agent" | "miller">(current?.kind ?? "agent");
  const list = tab === "agent" ? agents : millers;

  const isPicked = (id: string) => current?.kind === tab && current?.id === id;

  return (
    <div className="space-y-3" data-testid="courier-picker">
      <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/70 w-fit">
        {(["agent", "miller"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            data-testid={`courier-tab-${k}`}
            className={`px-3 py-1 rounded-md text-xs font-semibold capitalize ${
              tab === k
                ? "bg-white dark:bg-slate-900 text-primary shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
          >
            {k === "agent" ? "Agents" : "Millers"} ({k === "agent" ? agents.length : millers.length}
            )
          </button>
        ))}
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-soft divide-y divide-slate-100 dark:divide-slate-800">
        {list.length === 0 && (
          <p className="text-xs text-muted text-center py-4 italic">
            No {tab === "agent" ? "agents" : "millers"} yet. Add one from the{" "}
            {tab === "agent" ? "Agents" : "Millers"} tab.
          </p>
        )}
        {list.map((p) => {
          const picked = isPicked(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              data-testid={`courier-option-${p.id}`}
              onClick={() => onPick(picked ? null : { kind: tab, id: p.id })}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                picked
                  ? "bg-emerald-500/10 text-primary"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700/40 text-secondary"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <ColorSwatch color={p.canva_color_hex} label={p.name} size={14} />
              <span className="flex-1 truncate font-medium">{p.name}</span>
              {picked && <Check size={14} className="text-emerald-500" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
