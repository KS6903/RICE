import { useEffect, useRef, useState } from "react";
import {
  MapPin,
  Search,
  Star,
  Trash2,
  X as XIcon,
  ChevronDown,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { useLocations, useGeocodeSearch, type GeocodeHit } from "../hooks/useLocations";
import { useActiveLocation } from "../hooks/useActiveLocation";
import WeatherWidget from "./WeatherWidget";

/** Header dropdown: shows the current weather as a clickable pill that opens
 *  a panel listing the user's saved locations + a search box. The saved-default
 *  drives the weather across every page; switching default updates it
 *  everywhere via React Query invalidation. */
export default function LocationPicker() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { list, create, setDefault, remove } = useLocations();
  const search = useGeocodeSearch(query);
  const active = useActiveLocation();

  // Close on outside-click / Escape — copied pattern from WarehousePicker.
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

  const saveAndUse = (hit: GeocodeHit) => {
    create.mutate(
      {
        label: hit.label,
        lat: hit.lat,
        lon: hit.lon,
        country: hit.country,
        region: hit.region,
        is_default: true,
      },
      {
        onSuccess: () => {
          setQuery("");
          setOpen(false);
        },
      },
    );
  };

  const saved = list.data ?? [];
  const showSearchResults = query.trim().length >= 2;

  return (
    <div className="relative" data-testid="location-picker">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-0 hover:opacity-80 transition-opacity"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="location-picker-trigger"
      >
        <WeatherWidget variant="compact" />
        <ChevronDown
          size={14}
          className={`text-muted ml-1 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="fixed inset-x-3 top-[4.5rem] sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-80 z-50 bg-white dark:bg-slate-900 rounded-xl shadow-2xl ring-1 ring-soft overflow-hidden"
          role="dialog"
          data-testid="location-picker-popover"
          style={{ transform: "translateZ(0)" }}
        >
          {/* Active location header */}
          <div className="px-4 py-3 border-b border-soft bg-slate-50/60 dark:bg-slate-800/40">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
              Current location
            </p>
            <p className="text-sm font-semibold text-primary truncate flex items-center gap-1.5 mt-0.5">
              <MapPin size={13} className="text-emerald-500 shrink-0" />
              {active.source === "saved"
                ? active.label
                : active.source === "gps"
                  ? "Your device location"
                  : "Detected from network"}
            </p>
          </div>

          {/* Saved favorites */}
          <div className="max-h-64 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
            {list.isLoading && (
              <p className="text-xs text-muted px-3 py-3 inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Loading favorites…
              </p>
            )}
            {!list.isLoading && saved.length === 0 && (
              <p className="text-xs text-muted px-3 py-3 italic">
                No favorites yet — search below to add one.
              </p>
            )}
            {saved.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-2 px-3 py-2 ${
                  s.is_default
                    ? "bg-emerald-500/10"
                    : "hover:bg-slate-100 dark:hover:bg-slate-700/40"
                }`}
                data-testid={`favorite-${s.id}`}
              >
                <button
                  type="button"
                  onClick={() => setDefault.mutate(s.id)}
                  className={`shrink-0 ${s.is_default ? "text-amber-400" : "text-slate-300 dark:text-slate-600 hover:text-amber-400"}`}
                  title={s.is_default ? "This is your default" : "Set as default"}
                  data-testid={`star-${s.id}`}
                  aria-label={s.is_default ? "Current default" : `Set ${s.label} as default`}
                >
                  <Star size={14} fill={s.is_default ? "currentColor" : "none"} />
                </button>
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => setDefault.mutate(s.id)}
                >
                  <p
                    className={`text-sm truncate ${s.is_default ? "font-semibold text-primary" : "text-secondary"}`}
                  >
                    {s.label}
                  </p>
                  <p className="text-[10px] text-muted tabular-nums">
                    {s.lat.toFixed(2)}, {s.lon.toFixed(2)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove.mutate(s.id)}
                  className="shrink-0 p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10"
                  title="Remove favorite"
                  data-testid={`delete-${s.id}`}
                  aria-label={`Remove ${s.label}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="border-t border-soft p-2 bg-slate-50/40 dark:bg-slate-800/30">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                className="input !py-1.5 !pl-7 !pr-7 text-sm w-full"
                placeholder="Search a city or place…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="location-search-input"
                maxLength={80}
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary p-0.5 rounded"
                  aria-label="Clear search"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>

            {showSearchResults && (
              <div className="mt-2 max-h-48 overflow-y-auto" data-testid="search-results">
                {search.isLoading && (
                  <p className="text-xs text-muted py-2 inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> Searching…
                  </p>
                )}
                {search.isError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 py-2 inline-flex items-center gap-1.5">
                    <AlertCircle size={12} />
                    {(search.error as any)?.response?.data?.detail ?? "Search failed."}
                  </p>
                )}
                {search.data && search.data.length === 0 && (
                  <p className="text-xs text-muted py-2 italic">No matches.</p>
                )}
                {search.data?.map((hit, idx) => (
                  <button
                    key={`${hit.lat}-${hit.lon}-${idx}`}
                    type="button"
                    onClick={() => saveAndUse(hit)}
                    disabled={create.isPending}
                    className="w-full text-left px-2 py-1.5 rounded-md text-sm text-secondary hover:bg-slate-100 dark:hover:bg-slate-700/40 disabled:opacity-50 flex items-center gap-1.5"
                    data-testid={`search-hit-${idx}`}
                  >
                    <MapPin size={11} className="text-muted shrink-0" />
                    <span className="flex-1 truncate">{hit.label}</span>
                    <Check
                      size={12}
                      className="text-emerald-500 opacity-0 group-hover:opacity-100"
                    />
                  </button>
                ))}
              </div>
            )}
            {!showSearchResults && (
              <p className="text-[10px] text-muted mt-1.5 px-0.5">
                Search proxied via HTTPS · no third party gets your account info
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
