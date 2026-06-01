import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Stage, Layer, Rect, Text, Line, Group, Label, Tag, Transformer } from "react-konva";
import type Konva from "konva";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import {
  Loader2, AlertCircle, ZoomIn, ZoomOut, Maximize2, X as XIcon,
  Building2, Package, Wheat, Clock, MapPin, Calendar, User as UserIcon,
  Pencil, Eye, Layers, History, ArrowUp, ArrowDown, ChevronRight,
  Wifi, WifiOff, ArrowDownToLine, Flame, FileBarChart2, Link2, Check,
  Hammer, Plus, Trash2, Move, Filter, DoorOpen, Square, Locate, HelpCircle,
} from "lucide-react";
import { useRealtimeCanva } from "./useRealtimeCanva";
import { DispatchModal } from "./DispatchModal";

/* ──────────────────────────────────────────────────────────────────────────── */
/* Types                                                                         */
/* ──────────────────────────────────────────────────────────────────────────── */

type Zone = {
  id: string;
  zone_type: string;
  name: string;
  x_m: number; y_m: number;
  width_m: number; height_m: number;
  color_hex: string;
  is_storage?: boolean;
  notes?: string;
};

type CanvaCustomer = {
  client_id: string | null;
  client_type: string | null;
  client_name: string;
  color_hex: string;
  pallet_count: number;
  pallet_ids: string[];
  weight_kg: number;
};

type Batch = {
  id: string;
  variety_code: string | null;
  variety_name: string | null;
  grade_code: string | null;
  client_type: string | null;
  client_name: string | null;
  sack_count: number;
  weight_kg: number;
  moisture_pct: number | null;
  milling_date: string;
  best_before_date: string | null;
  days_until_expiry: number;
  status: "fresh" | "warning" | "critical" | "expired";
};

type Pallet = {
  id: string;
  pallet_code: string;
  zone_id: string | null;
  x_m: number; y_m: number;
  z_layer: number;
  stack_parent_id: string | null;
  width_m: number; depth_m: number;
  sack_count: number;
  weight_kg: number;
  status: string;
  aging_status: "fresh" | "warning" | "critical" | "expired";
  batches: Batch[];
};

type CanvaData = {
  layout: { id: string; name: string; branch_name: string; width_m: number; height_m: number; grid_size_m: number };
  zones: Zone[];
  pallets: Pallet[];
  summary: { total_pallets: number; total_weight_kg: number; by_aging: Record<string, number> };
};

type Movement = {
  id: string;
  movement_type: string;
  from_x_m: number | null; from_y_m: number | null;
  to_x_m: number | null; to_y_m: number | null;
  notes: string | null;
  created_at: string;
};

const AGING_FILL: Record<Batch["status"], string> = {
  fresh:    "#10b981",
  warning:  "#f59e0b",
  critical: "#f43f5e",
  expired:  "#7f1d1d",
};
const AGING_LABEL: Record<Batch["status"], string> = {
  fresh: "Fresh", warning: "Warning", critical: "Critical", expired: "Expired",
};

const PX_PER_METER_DEFAULT = 40;
const WRITE_ROLES = new Set(["owner", "admin", "mill_operator"]);

const STRUCTURAL_TYPES = new Set(["wall", "door", "walkway", "loading_dock"]);

const STORAGE_ZONE_TYPES = [
  "general", "milling", "premium_storage", "customer_storage",
  "paddy_intake", "drying", "shipping_dock", "office",
];

const DEFAULT_NEW_ZONE_SIZE: Record<string, { w: number; h: number }> = {
  general:          { w: 4, h: 3 },
  milling:          { w: 6, h: 4 },
  premium_storage:  { w: 6, h: 4 },
  customer_storage: { w: 4, h: 3 },
  paddy_intake:     { w: 5, h: 3 },
  drying:           { w: 5, h: 3 },
  shipping_dock:    { w: 5, h: 3 },
  office:           { w: 4, h: 3 },
  wall:             { w: 5, h: 0.5 },
  door:             { w: 1.2, h: 0.5 },
  walkway:          { w: 2, h: 5 },
  loading_dock:     { w: 4, h: 1 },
};

function defaultZoneName(zoneType: string): string {
  return zoneType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Stable callback wrapper — identity never changes, always calls the latest fn.
 *  Lets us memo() children without losing access to fresh state in handlers. */
function useEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Main component                                                                */
/* ──────────────────────────────────────────────────────────────────────────── */

export default function WarehouseCanva({
  branchId, layoutId, onNewLayout,
}: {
  branchId: string;
  layoutId?: string;
  /** Optional callback wired from the layout tab bar — when provided, the
   *  slim header renders a "+ New layout" button next to the mode toggles. */
  onNewLayout?: () => void;
}) {
  // Cache key: specific layoutId when available, otherwise falls back to branchId
  const cacheKey = layoutId || branchId;
  const qc = useQueryClient();
  const userRole = useAuthStore((s) => s.user?.role ?? "");
  const canEdit = WRITE_ROLES.has(userRole);

  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const palletTransformerRef = useRef<Konva.Transformer>(null);
  const roRafRef = useRef<number | null>(null);
  const lastPalletRef = useRef<Pallet | null>(null);
  const lastZoneRef = useRef<Zone | null>(null);
  // Hot-path cache — read by Transformer boundBoxFunc on every transform frame
  // so it doesn't have to scan `data.zones` and re-multiply layout dims for each tick.
  const transformBoundsRef = useRef<{ isStructural: boolean; layoutW_px: number; layoutH_px: number }>({
    isStructural: false, layoutW_px: 0, layoutH_px: 0,
  });
  const [stageSize, setStageSize] = useState({ width: 900, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 40, y: 40 });
  const [selectedPalletId, setSelectedPalletId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [stackPrompt, setStackPrompt] = useState<{ child: Pallet; parent: Pallet } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [showDispatch, setShowDispatch] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showAging, setShowAging] = useState(false);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  // Phase 5 — Builder / Layout mode + selection + filters
  const [layoutMode, setLayoutMode] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [pendingZoneType, setPendingZoneType] = useState<string | null>(null);  // "wall" | "door" | ... when armed to draw
  const [selectedClientNames, setSelectedClientNames] = useState<string[]>([]); // empty = show all
  const [showLayoutSize, setShowLayoutSize] = useState(false);

  const { data: customers = [] } = useQuery<CanvaCustomer[]>({
    queryKey: ["canva-customers", cacheKey],
    queryFn: () => api.get(`/canva/customers?branch_id=${branchId}`).then(r => r.data),
    refetchOnWindowFocus: false,
  });
  const clientColorByName = useMemo(() => {
    const m = new Map<string, string>();
    customers.forEach(c => m.set(c.client_name, c.color_hex));
    return m;
  }, [customers]);

  const canvaUrl = layoutId
    ? `/warehouses/${branchId}/canva?layout_id=${layoutId}`
    : `/warehouses/${branchId}/canva`;

  const { data, isLoading, error } = useQuery<CanvaData>({
    queryKey: ["canva", cacheKey],
    queryFn: () => api.get(canvaUrl).then(r => r.data),
    refetchOnWindowFocus: false,
    enabled: !!branchId,
  });

  const palletCountByZoneId = useMemo(() => {
    const m = new Map<string, number>();
    (data?.pallets ?? []).forEach(p => {
      if (p.zone_id) m.set(p.zone_id, (m.get(p.zone_id) ?? 0) + 1);
    });
    return m;
  }, [data?.pallets]);

  // Realtime sync — applies remote pallet.moved/stacked/unstacked events to the cache
  const liveStatus = useRealtimeCanva(data?.layout.id, cacheKey);

  // Deep-link sync: read ?pallet=PL-... on load → select the matching pallet
  useEffect(() => {
    if (!data) return;
    const code = searchParams.get("pallet");
    if (!code) return;
    const match = data.pallets.find(p => p.pallet_code === code);
    if (match && selectedPalletId !== match.id) {
      setSelectedPalletId(match.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.pallets.length, searchParams.get("pallet")]);

  // Push the selected pallet's code to the URL so it's shareable / QR-scannable
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (selectedPalletId && data) {
      const p = data.pallets.find(p => p.id === selectedPalletId);
      if (p) params.set("pallet", p.pallet_code);
    } else {
      params.delete("pallet");
    }
    const next = params.toString();
    if (next !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPalletId, data?.layout.id]);

  // Resize observer — rAF-throttled so Stage width updates every frame during
  // the CSS width transition on the side panel, producing smooth canva resizing.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      if (roRafRef.current !== null) return;
      roRafRef.current = requestAnimationFrame(() => {
        roRafRef.current = null;
        setStageSize({ width: el.clientWidth, height: Math.max(600, el.clientHeight) });
      });
    });
    ro.observe(el);
    setStageSize({ width: el.clientWidth, height: Math.max(600, el.clientHeight) });
    return () => {
      ro.disconnect();
      if (roRafRef.current !== null) cancelAnimationFrame(roRafRef.current);
    };
  }, []);

  // Auto-fit on first data load
  useEffect(() => {
    if (!data) return;
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.layout.id, stageSize.width, stageSize.height]);

  const fitToView = () => {
    if (!data) return;
    const layoutWPx = data.layout.width_m * PX_PER_METER_DEFAULT;
    const layoutHPx = data.layout.height_m * PX_PER_METER_DEFAULT;
    const scaleX = (stageSize.width - 80) / layoutWPx;
    const scaleY = (stageSize.height - 80) / layoutHPx;
    const newZoom = Math.min(scaleX, scaleY, 1.5);
    setZoom(newZoom);
    setStagePos({
      x: (stageSize.width - layoutWPx * newZoom) / 2,
      y: (stageSize.height - layoutHPx * newZoom) / 2,
    });
  };

  // Pinch-to-zoom only (trackpad two-finger spread/retract). Regular wheel
  // scroll must NEVER zoom — it should just be a no-op on the canva.
  // Browsers report pinch gestures as `wheel` events with `ctrlKey: true`,
  // and ordinary scroll as `ctrlKey: false`. We bail out early for the latter.
  const wheelRafRef = useRef<number | null>(null);
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!e.evt.ctrlKey) return;          // <- ignore plain scroll
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const scaleBy = 1.04;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.max(0.2, Math.min(4, direction > 0 ? oldScale * scaleBy : oldScale / scaleBy));
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    stage.scale({ x: newScale, y: newScale });
    stage.position(newPos);
    stage.batchDraw();
    if (wheelRafRef.current !== null) return;
    wheelRafRef.current = requestAnimationFrame(() => {
      wheelRafRef.current = null;
      setZoom(stage.scaleX());
      setStagePos({ x: stage.x(), y: stage.y() });
    });
  };
  useEffect(() => () => {
    if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);
  }, []);


  /* ── Mutations ───────────────────────────────────────────────────────── */

  // Optimistic move: write the new x/y into the React Query cache immediately,
  // call the server, rollback if it rejects.
  const moveMutation = useMutation({
    mutationFn: ({ palletId, x_m, y_m }: { palletId: string; x_m: number; y_m: number }) =>
      api.patch(`/pallets/${palletId}/move`, { x_m, y_m }).then(r => r.data),
    onMutate: async ({ palletId, x_m, y_m }) => {
      await qc.cancelQueries({ queryKey: ["canva", cacheKey] });
      const previous = qc.getQueryData<CanvaData>(["canva", cacheKey]);
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return {
          ...old,
          pallets: old.pallets.map(p => p.id === palletId ? { ...p, x_m, y_m } : p),
        };
      });
      return { previous };
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["canva", cacheKey], ctx.previous);
      const detail = err?.response?.data?.detail || "Could not move pallet.";
      setErrorBanner(detail);
      setTimeout(() => setErrorBanner(null), 4000);
    },
    onSuccess: (updated: Pallet) => {
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, pallets: old.pallets.map(p => p.id === updated.id ? updated : p) };
      });
    },
  });

  const stackMutation = useMutation({
    mutationFn: ({ palletId, parentId }: { palletId: string; parentId: string }) =>
      api.patch(`/pallets/${palletId}/stack`, { parent_pallet_id: parentId }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canva", cacheKey] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || "Could not stack pallet.";
      setErrorBanner(detail);
      setTimeout(() => setErrorBanner(null), 4000);
    },
  });

  const unstackMutation = useMutation({
    mutationFn: ({ palletId, x_m, y_m }: { palletId: string; x_m?: number; y_m?: number }) =>
      api.patch(`/pallets/${palletId}/unstack`, { x_m, y_m }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canva", cacheKey] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || "Could not unstack pallet.";
      setErrorBanner(detail);
      setTimeout(() => setErrorBanner(null), 4000);
    },
  });

  // Pallet resize — optimistic so the Konva Transformer settles instantly,
  // server reconciles afterward.
  const palletResizeMutation = useMutation({
    mutationFn: ({ palletId, width_m, depth_m }: { palletId: string; width_m: number; depth_m: number }) =>
      api.patch(`/pallets/${palletId}/resize`, { width_m, depth_m }).then(r => r.data),
    onMutate: async ({ palletId, width_m, depth_m }) => {
      await qc.cancelQueries({ queryKey: ["canva", cacheKey] });
      const previous = qc.getQueryData<CanvaData>(["canva", cacheKey]);
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return {
          ...old,
          pallets: old.pallets.map(p => p.id === palletId ? { ...p, width_m, depth_m } : p),
        };
      });
      return { previous };
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["canva", cacheKey], ctx.previous);
      const detail = err?.response?.data?.detail || "Could not resize pallet.";
      setErrorBanner(detail);
      setTimeout(() => setErrorBanner(null), 4000);
    },
    onSuccess: (updated: Pallet) => {
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, pallets: old.pallets.map(p => p.id === updated.id ? updated : p) };
      });
    },
  });

  /* ── Phase 5: zone + layout mutations ────────────────────────────────── */

  const flashError = (msg: string) => {
    setErrorBanner(msg);
    setTimeout(() => setErrorBanner(null), 4000);
  };

  const layoutPatchMutation = useMutation({
    mutationFn: (body: { name?: string; width_m?: number; height_m?: number; grid_size_m?: number }) => {
      const url = layoutId
        ? `/warehouses/${branchId}/layout?layout_id=${layoutId}`
        : `/warehouses/${branchId}/layout`;
      return api.patch(url, body).then(r => r.data);
    },
    onSuccess: (updated: any) => {
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, layout: { ...old.layout, ...updated } };
      });
    },
    onError: (err: any) => flashError(err?.response?.data?.detail || "Could not update layout."),
  });

  const zoneCreateMutation = useMutation({
    mutationFn: (body: any) => {
      const url = layoutId
        ? `/warehouses/${branchId}/zones?layout_id=${layoutId}`
        : `/warehouses/${branchId}/zones`;
      return api.post(url, body).then(r => r.data);
    },
    onMutate: async (body: any) => {
      // Optimistic: tack a temp zone on so the user sees their drag immediately
      await qc.cancelQueries({ queryKey: ["canva", cacheKey] });
      const tmpId = `_tmp_${Date.now()}`;
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return {
          ...old,
          zones: [...old.zones, {
            id: tmpId,
            zone_type: body.zone_type, name: body.name,
            x_m: body.x_m, y_m: body.y_m, width_m: body.width_m, height_m: body.height_m,
            color_hex: body.color_hex ?? "#94a3b8",
            is_storage: !["wall", "door", "walkway", "loading_dock"].includes(body.zone_type),
          }],
        };
      });
      return { tmpId };
    },
    onSuccess: (zone: Zone, _vars, ctx: any) => {
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, zones: old.zones.map(z => z.id === ctx?.tmpId ? zone : z) };
      });
      setSelectedZoneId(zone.id);
    },
    onError: (err: any, _vars, ctx: any) => {
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, zones: old.zones.filter(z => z.id !== ctx?.tmpId) };
      });
      flashError(err?.response?.data?.detail || "Could not create zone.");
    },
  });

  const zoneUpdateMutation = useMutation({
    mutationFn: ({ zoneId, body }: { zoneId: string; body: any }) =>
      api.patch(`/zones/${zoneId}`, body).then(r => r.data),
    onMutate: async ({ zoneId, body }) => {
      await qc.cancelQueries({ queryKey: ["canva", cacheKey] });
      const previous = qc.getQueryData<CanvaData>(["canva", cacheKey]);
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, zones: old.zones.map(z => z.id === zoneId ? { ...z, ...body } : z) };
      });
      return { previous };
    },
    onSuccess: (zone: Zone) => {
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, zones: old.zones.map(z => z.id === zone.id ? zone : z) };
      });
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(["canva", cacheKey], ctx.previous);
      flashError(err?.response?.data?.detail || "Could not update zone.");
    },
  });

  const zoneDeleteMutation = useMutation({
    mutationFn: (zoneId: string) => api.delete(`/zones/${zoneId}`).then(r => r.data),
    onSuccess: (_data, zoneId) => {
      qc.setQueryData<CanvaData>(["canva", cacheKey], (old) => {
        if (!old) return old;
        return { ...old, zones: old.zones.filter(z => z.id !== zoneId) };
      });
      if (selectedZoneId === zoneId) setSelectedZoneId(null);
    },
    onError: (err: any) => flashError(err?.response?.data?.detail || "Could not delete zone."),
  });

  /* ── Drop handling: did we land on another pallet? If so, prompt stack. ── */

  // Stable callbacks so PalletShape can be memo()'d. useEvent keeps the identity
  // fixed while always invoking the latest closure (so we see fresh `data`).
  const onPalletClick = useCallback((id: string) => setSelectedPalletId(id), []);

  const onPalletDragEnd = useEvent((palletId: string, dropX_m: number, dropY_m: number) => {
    if (!data) return;
    const pallet = data.pallets.find(p => p.id === palletId);
    if (!pallet) return;
    const gridSize = data.layout.grid_size_m;
    const snappedX = snapToGrid(dropX_m, gridSize);
    const snappedY = snapToGrid(dropY_m, gridSize);

    const dropCx = snappedX + pallet.width_m / 2;
    const dropCy = snappedY + pallet.depth_m / 2;

    const overlapped = data.pallets.find(p => {
      if (p.id === pallet.id) return false;
      return dropCx >= p.x_m && dropCx <= p.x_m + p.width_m
          && dropCy >= p.y_m && dropCy <= p.y_m + p.depth_m;
    });

    if (overlapped) {
      setStackPrompt({ child: pallet, parent: overlapped });
      return;
    }

    moveMutation.mutate({ palletId: pallet.id, x_m: snappedX, y_m: snappedY });
  });

  const onZoneClick = useEvent((id: string) => {
    if (layoutMode) setSelectedZoneId(id);
  });
  const onZoneChange = useEvent((zoneId: string, patch: { x_m?: number; y_m?: number; width_m?: number; height_m?: number }) => {
    zoneUpdateMutation.mutate({ zoneId, body: patch });
  });

  const confirmStack = () => {
    if (!stackPrompt) return;
    stackMutation.mutate({ palletId: stackPrompt.child.id, parentId: stackPrompt.parent.id });
    setStackPrompt(null);
  };

  const selectedPallet = useMemo(
    () => data?.pallets.find(p => p.id === selectedPalletId) || null,
    [data, selectedPalletId]
  );
  if (selectedPallet) lastPalletRef.current = selectedPallet;

  // Keep zone ref live so ZoneEditor can finish its closing animation with real data
  const selectedZone = useMemo(
    () => (layoutMode && selectedZoneId ? data?.zones.find(z => z.id === selectedZoneId) ?? null : null),
    [data, layoutMode, selectedZoneId]
  );
  if (selectedZone) lastZoneRef.current = selectedZone;

  const displayPallet = selectedPallet ?? lastPalletRef.current;
  const displayZone   = selectedZone   ?? lastZoneRef.current;

  // Attach/detach the Konva Transformer to whichever zone is selected.
  // Runs when selection or zones list changes so the transformer tracks layout edits.
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (layoutMode && selectedZoneId && data) {
      const node = stage.findOne(`#zone-${selectedZoneId}`) as Konva.Group | undefined;
      tr.nodes(node ? [node] : []);

      // For storage zones: snap any out-of-bounds position back inside the floor.
      // Structural zones (door, wall, walkway, loading_dock) are intentionally
      // allowed outside the boundary, so skip the correction for them.
      if (node) {
        const selectedZone = data.zones.find(z => z.id === selectedZoneId);
        const isStructural = selectedZone?.is_storage === false;
        // Refresh the per-frame cache read by Transformer.boundBoxFunc — avoids
        // re-finding the zone and re-multiplying layout dims on every transform tick.
        transformBoundsRef.current = {
          isStructural,
          layoutW_px: data.layout.width_m * PX_PER_METER_DEFAULT,
          layoutH_px: data.layout.height_m * PX_PER_METER_DEFAULT,
        };
        if (!isStructural) {
          const lw = data.layout.width_m * PX_PER_METER_DEFAULT;
          const lh = data.layout.height_m * PX_PER_METER_DEFAULT;
          const firstRect = node.findOne('Rect') as Konva.Rect | undefined;
          const nw = Math.min(firstRect?.width() ?? 0, lw);
          const nh = Math.min(firstRect?.height() ?? 0, lh);
          const cx = Math.max(0, Math.min(node.x(), lw - nw));
          const cy = Math.max(0, Math.min(node.y(), lh - nh));
          const needsFix = cx !== node.x() || cy !== node.y() || nw !== (firstRect?.width() ?? nw) || nh !== (firstRect?.height() ?? nh);
          if (needsFix) {
            node.x(cx); node.y(cy);
            const patch: Record<string, number> = { x_m: cx / PX_PER_METER_DEFAULT, y_m: cy / PX_PER_METER_DEFAULT };
            if (nw !== (firstRect?.width() ?? nw)) patch.width_m  = nw / PX_PER_METER_DEFAULT;
            if (nh !== (firstRect?.height() ?? nh)) patch.height_m = nh / PX_PER_METER_DEFAULT;
            zoneUpdateMutation.mutate({ zoneId: selectedZoneId, body: patch });
          }
        }
      }
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [layoutMode, selectedZoneId, data?.zones.length]);

  // ── Pallet resize Transformer ─────────────────────────────────────────────
  // Attach the pallet-only Transformer to the currently selected pallet when
  // we're in edit mode (so users can resize a pallet by dragging its corners).
  useEffect(() => {
    const tr = palletTransformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (editMode && !layoutMode && selectedPalletId && data) {
      const node = stage.findOne(`#pallet-${selectedPalletId}`) as Konva.Group | undefined;
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [editMode, layoutMode, selectedPalletId, data?.pallets.length]);

  const onPalletTransformEnd = useEvent(() => {
    const stage = stageRef.current;
    if (!stage || !selectedPalletId || !data) return;
    const node = stage.findOne(`#pallet-${selectedPalletId}`) as Konva.Group;
    if (!node) return;
    const p = data.pallets.find(x => x.id === selectedPalletId);
    if (!p) return;

    const sx = node.scaleX();
    const sy = node.scaleY();
    let new_w_m = (p.width_m * sx);
    let new_d_m = (p.depth_m * sy);

    // Clamp to backend's accepted range so we don't 400 on submit.
    new_w_m = Math.max(0.4, Math.min(6.0, new_w_m));
    new_d_m = Math.max(0.4, Math.min(6.0, new_d_m));
    new_w_m = Math.round(new_w_m * 100) / 100;
    new_d_m = Math.round(new_d_m * 100) / 100;

    // Reset scale so the new size persists via props (width/depth) instead of scale.
    node.scaleX(1);
    node.scaleY(1);
    node.getLayer()?.batchDraw();

    palletResizeMutation.mutate({ palletId: selectedPalletId, width_m: new_w_m, depth_m: new_d_m });
  });

  // Handles Transformer resize/move end: persist new size AND position,
  // clamped to warehouse bounds so zones can never overflow the floor.
  // onTransformEnd fires for BOTH resize (scale != 1) and border-drag move.
  const onZoneTransformEnd = useEvent(() => {
    const stage = stageRef.current;
    if (!stage || !selectedZoneId || !data) return;
    const node = stage.findOne(`#zone-${selectedZoneId}`) as Konva.Group;
    if (!node) return;
    const zone = data.zones.find(z => z.id === selectedZoneId);
    if (!zone) return;
    const grid = data.layout.grid_size_m;
    const layoutW = data.layout.width_m;
    const layoutH = data.layout.height_m;

    // Read the RECT child's pixel dimensions — these reflect the current React props
    // (zone.width_m * PX_PER_METER_DEFAULT), which may be updated by a prior optimistic
    // update. Using the Rect directly avoids stale-closure issues with zone.width_m.
    const firstRect = node.findOne('Rect') as Konva.Rect | undefined;
    const baseW = firstRect ? firstRect.width() : zone.width_m * PX_PER_METER_DEFAULT;
    const baseH = firstRect ? firstRect.height() : zone.height_m * PX_PER_METER_DEFAULT;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const rawW_m = (baseW * scaleX) / PX_PER_METER_DEFAULT;
    const rawH_m = (baseH * scaleY) / PX_PER_METER_DEFAULT;
    const rawX_m = node.x() / PX_PER_METER_DEFAULT;
    const rawY_m = node.y() / PX_PER_METER_DEFAULT;

    // Structural zones (door, wall, walkway, loading_dock) may live anywhere;
    // storage zones are clamped inside the warehouse floor.
    const isStructural = zone.is_storage === false;
    const newW_m = Math.max(grid, snapToGrid(rawW_m, grid));
    const newH_m = Math.max(grid, snapToGrid(rawH_m, grid));
    const snappedX = snapToGrid(rawX_m, grid);
    const snappedY = snapToGrid(rawY_m, grid);
    const newX_m = isStructural ? snappedX : Math.min(Math.max(0, snappedX), layoutW - newW_m);
    const newY_m = isStructural ? snappedY : Math.min(Math.max(0, snappedY), layoutH - newH_m);

    node.scaleX(1);
    node.scaleY(1);
    node.x(newX_m * PX_PER_METER_DEFAULT);
    node.y(newY_m * PX_PER_METER_DEFAULT);

    zoneUpdateMutation.mutate({ zoneId: selectedZoneId, body: { width_m: newW_m, height_m: newH_m, x_m: newX_m, y_m: newY_m } });
  });

  /* ── Loading / error ─────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="card flex items-center justify-center h-[600px] gap-2 text-secondary">
        <Loader2 size={18} className="animate-spin" /> Loading warehouse canva…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="card text-center py-16">
        <AlertCircle size={32} className="mx-auto text-rose-500 mb-2" />
        <p className="text-secondary">Could not load warehouse canva.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ─── Slim header bar — name + dimensions + live + mode toggles ─── */}
      <div data-testid="warehouse-header" className="glass rounded-2xl px-4 py-2.5 flex items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 w-7 h-7 rounded-lg bg-grad-brand flex items-center justify-center shadow-grad-glow">
            <Building2 size={14} className="text-white" />
          </span>
          <h2 className="font-semibold text-primary text-sm truncate">{data.layout.name}</h2>
          <span className="shrink-0 text-[11px] font-medium text-secondary bg-slate-100 dark:bg-slate-800/70 px-2 py-0.5 rounded-md tabular-nums">
            {data.layout.width_m}m × {data.layout.height_m}m
          </span>
          {/* Orientation chip — tiny floor-plan thumbnail + label */}
          {(() => {
            const w = Number(data.layout.width_m);
            const h = Number(data.layout.height_m);
            const orient: "Vertical" | "Horizontal" | "Square" =
              w === h ? "Square" : (h > w ? "Vertical" : "Horizontal");
            // Scale to a 22×14 thumbnail max
            const scale = Math.min(22 / w, 14 / h);
            const tw = Math.max(4, Math.round(w * scale));
            const th = Math.max(4, Math.round(h * scale));
            return (
              <span
                data-testid="warehouse-orientation"
                className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-secondary bg-slate-100 dark:bg-slate-800/70 px-2 py-0.5 rounded-md"
                title={`${orient} orientation`}
              >
                <span className="inline-flex items-center justify-center w-[26px] h-[16px] bg-slate-200/70 dark:bg-slate-700/60 rounded ring-1 ring-inset ring-slate-300/60 dark:ring-slate-600/50">
                  <span
                    className="bg-emerald-400/80 ring-1 ring-emerald-500/60 rounded-[2px]"
                    style={{ width: tw, height: th }}
                  />
                </span>
                {orient}
              </span>
            );
          })()}
          <LiveBadge status={liveStatus} />
        </div>

        {canEdit && (
          <div className="ml-auto flex items-center gap-1.5">
            {onNewLayout && (
              <button
                data-testid="header-new-layout"
                onClick={onNewLayout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 ring-emerald-400 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-all"
                title="Create a new warehouse layout"
              >
                <Plus size={12} />
                New layout
              </button>
            )}
            <button
              onClick={() => { setEditMode(m => !m); if (!editMode) setLayoutMode(false); }}
              disabled={layoutMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                editMode
                  ? "bg-sky-600 text-white shadow-sm hover:bg-sky-700"
                  : "ring-1 ring-slate-300 dark:ring-slate-600 text-secondary hover:bg-slate-100 dark:hover:bg-slate-700/40"
              }`}
              title={editMode ? "Click to stop moving and just look" : "Click to start moving pallets around"}
            >
              {editMode ? <Pencil size={12} /> : <Eye size={12} />}
              {editMode ? "Move pallets" : "View only"}
            </button>
            <button
              onClick={() => { setLayoutMode(m => !m); setEditMode(false); setPendingZoneType(null); setSelectedZoneId(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                layoutMode
                  ? "bg-violet-600 text-white shadow-sm hover:bg-violet-700"
                  : "ring-1 ring-violet-300 dark:ring-violet-600 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40"
              }`}
              title={layoutMode ? "Click to stop editing the floor plan" : "Click to draw walls, doors, and zones"}
            >
              <Hammer size={12} />
              {layoutMode ? "Editing floor plan" : "Edit floor plan"}
            </button>
            <HelpButton />
          </div>
        )}
      </div>

      {/* Error banner (drag rejection, stack-limit, etc.) */}
      {errorBanner && (
        <div className="card !p-3 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60 flex items-center gap-2 text-sm">
          <AlertCircle size={15} className="text-rose-600 dark:text-rose-400 shrink-0" />
          <span className="text-rose-900 dark:text-rose-100">{errorBanner}</span>
        </div>
      )}

      {/* Edit-mode hint — plain-language reminder of how Move mode works */}
      {editMode && (
        <div className="card !p-3 bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800/60 flex items-center gap-2 text-sm">
          <Pencil size={13} className="text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="text-sky-900 dark:text-sky-100">
            <strong>Move mode is on.</strong> Drag any pallet to a new spot. Drop one pallet on top of another to <strong>stack</strong> them. Click a pallet to see details or to resize it.
          </span>
        </div>
      )}

      {/* Builder toolbox */}
      {layoutMode && (
        <BuilderToolbox
          layout={data.layout}
          pendingZoneType={pendingZoneType}
          setPendingZoneType={setPendingZoneType}
          showLayoutSize={showLayoutSize}
          setShowLayoutSize={setShowLayoutSize}
          onResize={(w, h) => layoutPatchMutation.mutate({ width_m: w, height_m: h })}
          onRename={(name) => layoutPatchMutation.mutate({ name })}
          onGridChange={(g) => layoutPatchMutation.mutate({ grid_size_m: g })}
        />
      )}

      {/* No gap-4 on the parent — side panels control their own left spacing so the
          CSS width transition drives the flex layout and the canva resizes smoothly. */}
      <div className="flex">
        <div
          ref={containerRef}
          className="relative flex-1 rounded-2xl overflow-hidden ring-1 ring-slate-700 dark:ring-slate-800 bg-slate-800 dark:bg-slate-900"
          style={{ minHeight: 600, height: "calc(100vh - 200px)" }}
        >
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            draggable
            x={stagePos.x}
            y={stagePos.y}
            scaleX={zoom}
            scaleY={zoom}
            onWheel={handleWheel}
            onDragEnd={(e) => {
              if (e.target === e.target.getStage()) {
                setStagePos({ x: e.target.x(), y: e.target.y() });
              }
            }}
            onMouseDown={(e) => {
              if (e.target !== e.target.getStage()) return;
              setSelectedPalletId(null);
              setSelectedZoneId(null);
              // Builder: clicking the floor while armed with a zone-type drops a new zone
              if (layoutMode && pendingZoneType) {
                const stage = e.target.getStage();
                if (!stage) return;
                const pos = stage.getPointerPosition();
                if (!pos) return;
                const x_m = (pos.x - stage.x()) / stage.scaleX() / PX_PER_METER_DEFAULT;
                const y_m = (pos.y - stage.y()) / stage.scaleY() / PX_PER_METER_DEFAULT;
                const grid = data.layout.grid_size_m;
                const def = DEFAULT_NEW_ZONE_SIZE[pendingZoneType] ?? { w: 4, h: 3 };
                const isStructuralType = STRUCTURAL_TYPES.has(pendingZoneType);
                zoneCreateMutation.mutate({
                  zone_type: pendingZoneType,
                  name: defaultZoneName(pendingZoneType),
                  x_m: snapToGrid(isStructuralType ? x_m - def.w / 2 : Math.max(0, x_m - def.w / 2), grid),
                  y_m: snapToGrid(isStructuralType ? y_m - def.h / 2 : Math.max(0, y_m - def.h / 2), grid),
                  width_m: def.w,
                  height_m: def.h,
                });
                setPendingZoneType(null);
              }
            }}
          >
            <Layer listening={false}>
              <WarehouseFloor layout={data.layout} />
            </Layer>
            <Layer>
              {data.zones.map(z => (
                <ZoneShape
                  key={z.id}
                  zone={z}
                  editing={layoutMode}
                  selected={selectedZoneId === z.id}
                  gridSize={data.layout.grid_size_m}
                  palletCount={palletCountByZoneId.get(z.id) ?? 0}
                  onClick={onZoneClick}
                  onChange={onZoneChange}
                />
              ))}
              {showHeatmap && <HeatmapOverlay zones={data.zones} pallets={data.pallets} />}
              {data.pallets.map(p => {
                const owner = p.batches[0]?.client_name ?? null;
                const ownerColor = owner ? clientColorByName.get(owner) ?? null : null;
                const filtered = selectedClientNames.length > 0 && (!owner || !selectedClientNames.includes(owner));
                return (
                  <PalletShape
                    key={p.id}
                    pallet={p}
                    selected={p.id === selectedPalletId}
                    highlighted={highlightedIds.includes(p.id)}
                    dimmed={(highlightedIds.length > 0 && !highlightedIds.includes(p.id)) || filtered}
                    draggable={editMode && !layoutMode}
                    gridSize={data.layout.grid_size_m}
                    clientColor={ownerColor}
                    onClick={onPalletClick}
                    onDragEnd={onPalletDragEnd}
                  />
                );
              })}

              {/* Canva-style transformer — attaches to selected zone in builder mode */}
              {layoutMode && (
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  keepRatio={false}
                  anchorFill="white"
                  anchorStroke="#0ea5e9"
                  anchorStrokeWidth={2}
                  anchorSize={10}
                  anchorCornerRadius={2}
                  borderStroke="#0ea5e9"
                  borderStrokeWidth={1.5}
                  borderDash={[5, 4]}
                  padding={4}
                  onTransformEnd={onZoneTransformEnd}
                  boundBoxFunc={(_, newBox) => {
                    // Hot path — runs on every transform tick (~60Hz). Read pre-computed
                    // cache from transformBoundsRef instead of scanning data.zones each
                    // frame, so resizing stays at a steady 60 fps even on dense layouts.
                    const grid = data.layout.grid_size_m * PX_PER_METER_DEFAULT;
                    const { isStructural, layoutW_px, layoutH_px } = transformBoundsRef.current;
                    const w = Math.max(grid, newBox.width);
                    const h = Math.max(grid, newBox.height);
                    if (isStructural) {
                      return { x: newBox.x, y: newBox.y, width: w, height: h, rotation: newBox.rotation };
                    }
                    const x = Math.max(0, Math.min(newBox.x, layoutW_px - w));
                    const y = Math.max(0, Math.min(newBox.y, layoutH_px - h));
                    return { x, y, width: Math.min(w, layoutW_px), height: Math.min(h, layoutH_px), rotation: newBox.rotation };
                  }}
                />
              )}

              {/* Pallet resize transformer — only active in edit mode (not builder mode),
                  attached via useEffect to the selected pallet's Group node. */}
              {editMode && !layoutMode && (
                <Transformer
                  ref={palletTransformerRef}
                  rotateEnabled={false}
                  keepRatio={false}
                  anchorFill="white"
                  anchorStroke="#0ea5e9"
                  anchorStrokeWidth={2}
                  anchorSize={8}
                  anchorCornerRadius={2}
                  borderStroke="#0ea5e9"
                  borderStrokeWidth={1.5}
                  borderDash={[4, 3]}
                  padding={2}
                  onTransformEnd={onPalletTransformEnd}
                  boundBoxFunc={(_, newBox) => {
                    // Clamp to ~6 m max footprint expressed in pixels at the default scale.
                    const MIN_PX = 0.4 * PX_PER_METER_DEFAULT;
                    const MAX_PX = 6.0 * PX_PER_METER_DEFAULT;
                    const w = Math.max(MIN_PX, Math.min(MAX_PX, newBox.width));
                    const h = Math.max(MIN_PX, Math.min(MAX_PX, newBox.height));
                    return { ...newBox, width: w, height: h };
                  }}
                />
              )}
            </Layer>
          </Stage>

          {/* ──────────────────────────────────────────────────────────────── */}
          {/* Floating chrome — single unified top bar, Canva-style            */}
          {/* All controls live in one floating row aligned with the FIFO box. */}
          {/* Wrapper is click-through; only the interactive controls capture  */}
          {/* pointer events so the canva still receives drops underneath.    */}
          {/* ──────────────────────────────────────────────────────────────── */}
          <div data-testid="warehouse-floating-bar" className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex justify-center">
            <div
              data-testid="warehouse-action-bar"
              className="glass-strong rounded-2xl p-1.5 flex items-center gap-1 shadow-2xl flex-wrap max-w-full [&_button]:pointer-events-auto"
            >
              {/* Aging summary cluster */}
              <div data-testid="warehouse-aging-summary" className="flex items-center gap-1 px-1">
                <AgingPill label="Fresh"    color={AGING_FILL.fresh}    count={data.summary.by_aging.fresh} />
                <AgingPill label="Warning"  color={AGING_FILL.warning}  count={data.summary.by_aging.warning} />
                <AgingPill label="Critical" color={AGING_FILL.critical} count={data.summary.by_aging.critical} />
                <AgingPill label="Expired"  color={AGING_FILL.expired}  count={data.summary.by_aging.expired} />
              </div>

              <div className="w-px h-6 bg-slate-300/50 dark:bg-slate-600/50 rounded-full" aria-hidden />

              {/* FIFO / Heatmap / Report action cluster — descriptive tooltips
                  spell out exactly what each button does in plain language. */}
              <button
                onClick={() => setShowDispatch(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 dark:hover:bg-emerald-400/15 transition-colors"
                title="FIFO — find the oldest pallets to send out first"
              >
                <ArrowDownToLine size={13} /> FIFO
              </button>
              <button
                onClick={() => setShowHeatmap(h => !h)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  showHeatmap
                    ? "bg-rose-600 text-white shadow-sm"
                    : "text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 dark:hover:bg-rose-400/15"
                }`}
                title="Heatmap — colour zones by how full they are"
              >
                <Flame size={13} /> Heatmap
              </button>
              <button
                onClick={() => setShowAging(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 dark:hover:bg-amber-400/15 transition-colors"
                title="Report — see which zones hold the oldest stock"
              >
                <FileBarChart2 size={13} /> Report
              </button>

              {/* Recenter — labeled pill so users who panned far can jump back to the warehouse */}
              <button
                data-testid="warehouse-recenter"
                onClick={fitToView}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-500/15 dark:hover:bg-sky-400/15 transition-colors"
                title="Recenter the camera on the warehouse"
              >
                <Locate size={13} /> Recenter
              </button>

              {/* Customer filter (only when customers exist) */}
              {customers.length > 0 && (
                <>
                  <div className="w-px h-6 bg-slate-300/50 dark:bg-slate-600/50 rounded-full" aria-hidden />
                  <div data-testid="warehouse-customer-filter" className="flex items-center">
                    <CustomerFilter
                      customers={customers}
                      selected={selectedClientNames}
                      onChange={setSelectedClientNames}
                    />
                  </div>
                </>
              )}

              {/* Zoom cluster — bigger 9×9 tap targets so the buttons are
                  easy to hit, even with a tremor or trackpad pointer. */}
              <div className="w-px h-6 bg-slate-300/50 dark:bg-slate-600/50 rounded-full" aria-hidden />
              <div data-testid="warehouse-zoom-toolbar" className="flex items-center gap-0.5">
                <button
                  onClick={() => setZoom(z => Math.max(0.2, z / 1.2))}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-slate-200/60 dark:hover:bg-slate-700/40"
                  title="Zoom out — see more of the warehouse"
                  aria-label="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <span className="text-xs font-semibold text-secondary tabular-nums w-11 text-center select-none">
                  {(zoom * 100).toFixed(0)}%
                </span>
                <button
                  onClick={() => setZoom(z => Math.min(4, z * 1.2))}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-slate-200/60 dark:hover:bg-slate-700/40"
                  title="Zoom in — see pallets up close"
                  aria-label="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
              </div>

              {/* Clear highlight chip (only when something is highlighted) */}
              {highlightedIds.length > 0 && (
                <>
                  <div className="w-px h-6 bg-slate-300/50 dark:bg-slate-600/50 rounded-full" aria-hidden />
                  <button
                    onClick={() => setHighlightedIds([])}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 dark:hover:bg-amber-400/15 transition-colors"
                    title="Clear highlight"
                  >
                    <XIcon size={13} /> Clear ({highlightedIds.length})
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Empty state — bottom-right, with plain-language guidance on
              how to actually fill the warehouse. Helps new tenants and people
              who just added a brand-new warehouse understand where stock
              comes from (it's added on the Milling / Paddy pages, not here). */}
          {data.pallets.length === 0 && (
            <div className="absolute bottom-3 right-3 z-10 max-w-xs rounded-xl bg-white dark:bg-slate-900 ring-1 ring-soft px-4 py-3 text-sm text-secondary shadow-2xl">
              <div className="flex items-center gap-2 mb-1">
                <Package size={16} className="text-amber-500 shrink-0" />
                <span className="font-semibold text-primary">This warehouse is empty</span>
              </div>
              <p className="text-xs leading-snug">
                Pallets show up here after you record stock. Buy paddy on the <strong className="text-primary">Paddy / Palay</strong> page, or finish a batch on the <strong className="text-primary">Milling</strong> page.
              </p>
            </div>
          )}
        </div>

        {/* Pallet inspector — mounted once ever selected, width-transitions open/closed.
            displayPallet keeps last data alive during the closing animation. */}
        {displayPallet && (
          <div
            className="shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out"
            style={{
              width: selectedPallet ? 373 : 0,
              opacity: selectedPallet ? 1 : 0,
            }}
          >
            <div className="flex h-full gap-4 pl-4 animate-panel-in">
              <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700 rounded-full shrink-0" />
              <PalletInspector
                pallet={displayPallet}
                onClose={() => setSelectedPalletId(null)}
                onUnstack={() => unstackMutation.mutate({ palletId: displayPallet.id })}
                canEdit={canEdit}
              />
            </div>
          </div>
        )}

        {/* Zone editor — same pattern */}
        {displayZone && (
          <div
            className="shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out"
            style={{
              width: selectedZone ? 353 : 0,
              opacity: selectedZone ? 1 : 0,
            }}
          >
            <div className="flex h-full gap-4 pl-4 animate-panel-in">
              <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700 rounded-full shrink-0" />
              <ZoneEditor
                zone={displayZone}
                onClose={() => setSelectedZoneId(null)}
                onChange={(patch) => zoneUpdateMutation.mutate({ zoneId: displayZone.id, body: patch })}
                onDelete={() => zoneDeleteMutation.mutate(displayZone.id)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Stack confirmation modal */}
      {stackPrompt && (
        <StackConfirmModal
          child={stackPrompt.child}
          parent={stackPrompt.parent}
          isPending={stackMutation.isPending}
          onCancel={() => setStackPrompt(null)}
          onConfirm={confirmStack}
        />
      )}

      {/* FIFO dispatch modal */}
      {showDispatch && (
        <DispatchModal
          branchId={branchId}
          onClose={() => setShowDispatch(false)}
          onApply={(ids) => setHighlightedIds(ids)}
        />
      )}

      {/* Aging report modal */}
      {showAging && (
        <AgingReportModal
          branchId={branchId}
          onClose={() => setShowAging(false)}
          onSelectPallet={(palletId) => { setSelectedPalletId(palletId); setShowAging(false); }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Sub-components                                                                */
/* ──────────────────────────────────────────────────────────────────────────── */

const WarehouseFloor = memo(function WarehouseFloor({ layout }: { layout: CanvaData["layout"] }) {
  const w = layout.width_m * PX_PER_METER_DEFAULT;
  const h = layout.height_m * PX_PER_METER_DEFAULT;
  const gridStep = layout.grid_size_m * PX_PER_METER_DEFAULT;

  const lines = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let x = 0; x <= w; x += gridStep) {
      out.push(
        <Line key={`vx-${x}`} points={[x, 0, x, h]} stroke="#c9b896" strokeWidth={x % (gridStep * 2) === 0 ? 1 : 0.5} opacity={0.7} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      );
    }
    for (let y = 0; y <= h; y += gridStep) {
      out.push(
        <Line key={`hy-${y}`} points={[0, y, w, y]} stroke="#c9b896" strokeWidth={y % (gridStep * 2) === 0 ? 1 : 0.5} opacity={0.7} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      );
    }
    return out;
  }, [w, h, gridStep]);

  const scaleBarPx = 5 * PX_PER_METER_DEFAULT;
  return (
    <>
      {/* Drop shadow — gives the floor plan a lifted, architectural feel */}
      <Rect x={7} y={9} width={w} height={h} fill="#000000" opacity={0.28} cornerRadius={3} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      {/* Warm concrete floor */}
      <Rect x={0} y={0} width={w} height={h} fill="#fef8ec" listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      {lines}
      {/* Architectural outer wall */}
      <Rect x={0} y={0} width={w} height={h} stroke="#1e293b" strokeWidth={7} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      {/* Inner border accent line */}
      <Rect x={3.5} y={3.5} width={w - 7} height={h - 7} stroke="#475569" strokeWidth={0.8} opacity={0.35} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      {/* Erase border at loading dock opening */}
      <Rect x={w / 2 - 56} y={h - 3.5} width={112} height={7} fill="#fef8ec" listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      {/* Loading dock bumper strip */}
      <Rect x={w / 2 - 72} y={h + 2} width={144} height={15} fill="#fde047" stroke="#92400e" strokeWidth={1.5} cornerRadius={3} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      <Text x={w / 2 - 68} y={h + 5} width={136} align="center" text="LOADING DOCK / PINTO" fontSize={9} fontStyle="bold" fill="#78350f" letterSpacing={1} listening={false} perfectDrawEnabled={false} />
      {/* Floor plan label (top-left, outside border) */}
      <Text x={20} y={-30} text={`BODEGA  ·  ${layout.name.toUpperCase()}`} fontSize={12} fontStyle="bold" fill="#94a3b8" letterSpacing={3} listening={false} perfectDrawEnabled={false} />
      {/* Scale bar (bottom-right, inside floor) */}
      <Rect x={w - scaleBarPx - 16} y={h - 22} width={scaleBarPx} height={3} fill="#94a3b8" opacity={0.5} cornerRadius={1.5} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      <Rect x={w - scaleBarPx - 16} y={h - 27} width={1.5} height={11} fill="#94a3b8" opacity={0.5} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      <Rect x={w - 15} y={h - 27} width={1.5} height={11} fill="#94a3b8" opacity={0.5} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      <Text x={w - scaleBarPx - 16} y={h - 13} width={scaleBarPx} align="center" text="5 m" fontSize={8} fill="#94a3b8" opacity={0.65} listening={false} perfectDrawEnabled={false} />
    </>
  );
});

type ZoneShapeProps = {
  zone: Zone;
  editing: boolean;
  selected: boolean;
  gridSize: number;
  palletCount: number;
  onClick: (id: string) => void;
  onChange: (zoneId: string, patch: { x_m?: number; y_m?: number; width_m?: number; height_m?: number }) => void;
};

const ZoneShape = memo(function ZoneShape({
  zone, editing, selected, gridSize, palletCount, onClick, onChange,
}: ZoneShapeProps) {
  const x = zone.x_m * PX_PER_METER_DEFAULT;
  const y = zone.y_m * PX_PER_METER_DEFAULT;
  const w = zone.width_m * PX_PER_METER_DEFAULT;
  const h = zone.height_m * PX_PER_METER_DEFAULT;
  const isStructural = zone.is_storage === false;

  const hoverRectRef = useRef<Konva.Rect>(null);

  // Structural elements: solid fill (wall = dark, door = yellow, walkway = light grey).
  // Storage zones: dashed outline with translucent fill.
  const structuralVisual = (() => {
    if (zone.zone_type === "wall") {
      return { fill: "#1f2937", stroke: "#0f172a", opacity: 1, dash: undefined as number[] | undefined };
    }
    if (zone.zone_type === "door") {
      return { fill: "#facc15", stroke: "#a16207", opacity: 0.95, dash: undefined };
    }
    if (zone.zone_type === "walkway") {
      return { fill: "#cbd5e1", stroke: "#94a3b8", opacity: 0.65, dash: [3, 3] };
    }
    if (zone.zone_type === "loading_dock") {
      return { fill: "#f59e0b", stroke: "#b45309", opacity: 0.85, dash: undefined };
    }
    return null;
  })();

  // Empty storage zones are invisible in view mode — they only appear in builder mode
  // or when they contain pallets. Skip rendering entirely (vs. opacity 0) so the node
  // is dropped from the Konva scene graph — every avoided draw cycle is FPS we keep
  // while the user pans/drags pallets across a dense layout.
  const isVisible = isStructural || editing || palletCount > 0;
  if (!isVisible) return null;

  return (
    <Group
      id={`zone-${zone.id}`}
      x={x} y={y}
      draggable={editing && !selected}
      listening={true}
      onClick={() => onClick(zone.id)}
      onTap={() => onClick(zone.id)}
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        // grab cursor only when zone is directly draggable (unselected in edit mode)
        if (stage) stage.container().style.cursor = (editing && !selected) ? "grab" : "default";
        if (editing && !selected) {
          hoverRectRef.current?.visible(true);
          hoverRectRef.current?.getLayer()?.batchDraw();
        }
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "default";
        hoverRectRef.current?.visible(false);
        hoverRectRef.current?.getLayer()?.batchDraw();
      }}
      onDragStart={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "grabbing";
        hoverRectRef.current?.visible(false);
      }}
      onDragEnd={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "grab";
        const nx_m = e.target.x() / PX_PER_METER_DEFAULT;
        const ny_m = e.target.y() / PX_PER_METER_DEFAULT;
        // Structural zones (door, wall, walkway, loading_dock) snap to grid but
        // are not clamped inside the floor — they may straddle or sit outside.
        const snappedX = zone.is_storage === false ? snapToGrid(nx_m, gridSize) : Math.max(0, snapToGrid(nx_m, gridSize));
        const snappedY = zone.is_storage === false ? snapToGrid(ny_m, gridSize) : Math.max(0, snapToGrid(ny_m, gridSize));
        e.target.position({ x: snappedX * PX_PER_METER_DEFAULT, y: snappedY * PX_PER_METER_DEFAULT });
        onChange(zone.id, { x_m: snappedX, y_m: snappedY });
      }}
    >
      {structuralVisual ? (
        <Rect
          width={w} height={h}
          fill={structuralVisual.fill}
          stroke={structuralVisual.stroke}
          strokeWidth={1.5}
          opacity={structuralVisual.opacity}
          dash={structuralVisual.dash}
          cornerRadius={zone.zone_type === "wall" ? 1 : 3}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      ) : (
        <Rect
          width={w} height={h}
          fill={zone.color_hex}
          opacity={palletCount === 0 ? 0.20 : 0.36}
          stroke={zone.color_hex}
          strokeWidth={2}
          cornerRadius={6}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      )}

      {/* Canva-style hover ring — visible only on hover in edit mode, hidden when selected (Transformer takes over) */}
      <Rect
        ref={hoverRectRef}
        width={w} height={h}
        fill="transparent"
        stroke="#60a5fa"
        strokeWidth={2}
        cornerRadius={6}
        visible={false}
        listening={false}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
      />

      {!isStructural && (
        <>
          <Text x={8} y={8} text={zone.name.toUpperCase()} fontSize={11} fontStyle="bold" fill={zone.color_hex} opacity={0.95} letterSpacing={1} listening={false} perfectDrawEnabled={false} />
          <Text x={8} y={h - 19} text={zone.zone_type.replace(/_/g, " ")} fontSize={9} fill={zone.color_hex} opacity={0.55} listening={false} perfectDrawEnabled={false} />
          {palletCount === 0 && editing && w > 80 && h > 60 && (
            <Text
              width={w} y={h / 2 - 8}
              align="center"
              text="EMPTY"
              fontSize={10}
              fontStyle="bold"
              fill={zone.color_hex}
              opacity={0.22}
              letterSpacing={4}
              listening={false}
              perfectDrawEnabled={false}
            />
          )}
        </>
      )}
      {isStructural && w > 50 && h > 14 && (
        <Text width={w} height={h} align="center" verticalAlign="middle"
              text={zone.name} fontSize={Math.min(11, h * 0.6)}
              fontStyle="bold"
              fill={zone.zone_type === "wall" ? "white" : "#0f172a"} opacity={0.7} listening={false} perfectDrawEnabled={false} />
      )}
    </Group>
  );
});

type PalletShapeProps = {
  pallet: Pallet;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
  draggable: boolean;
  gridSize: number;
  clientColor: string | null;
  onClick: (id: string) => void;
  onDragEnd: (id: string, x_m: number, y_m: number) => void;
};

const PalletShape = memo(function PalletShape({
  pallet, selected, highlighted, dimmed, draggable, gridSize, clientColor, onClick, onDragEnd,
}: PalletShapeProps) {
  const x = pallet.x_m * PX_PER_METER_DEFAULT;
  const y = pallet.y_m * PX_PER_METER_DEFAULT;
  const w = pallet.width_m * PX_PER_METER_DEFAULT;
  const h = pallet.depth_m * PX_PER_METER_DEFAULT;
  const fill = AGING_FILL[pallet.aging_status];
  const variety = pallet.batches[0]?.variety_code || "—";
  const baseOpacity = dimmed ? 0.25 : 1;
  const strokeColor = highlighted
    ? "#fbbf24"           // amber-400, FIFO highlight
    : selected
      ? "#0ea5e9"
      : "#1f2937";
  const strokeW = highlighted ? 4 : selected ? 3 : 1;

  // Refs let hover/drag mutate Konva directly without triggering React renders.
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);

  return (
    <Group
      id={`pallet-${pallet.id}`}
      ref={groupRef}
      x={x}
      y={y}
      draggable={draggable}
      opacity={baseOpacity}
      onClick={() => onClick(pallet.id)}
      onTap={() => onClick(pallet.id)}
      onDragStart={() => {
        const g = groupRef.current;
        if (g) { g.opacity(0.7); g.getLayer()?.batchDraw(); }
      }}
      onDragEnd={(e) => {
        const newX_m = e.target.x() / PX_PER_METER_DEFAULT;
        const newY_m = e.target.y() / PX_PER_METER_DEFAULT;
        const snappedX = snapToGrid(newX_m, gridSize);
        const snappedY = snapToGrid(newY_m, gridSize);
        e.target.position({ x: snappedX * PX_PER_METER_DEFAULT, y: snappedY * PX_PER_METER_DEFAULT });
        const g = groupRef.current;
        if (g) { g.opacity(baseOpacity); g.getLayer()?.batchDraw(); }
        onDragEnd(pallet.id, snappedX, snappedY);
      }}
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = draggable ? "grab" : "pointer";
        if (!selected && !highlighted) {
          const r = rectRef.current;
          if (r) { r.stroke("#0f172a"); r.getLayer()?.batchDraw(); }
        }
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "default";
        if (!selected && !highlighted) {
          const r = rectRef.current;
          if (r) { r.stroke("#1f2937"); r.getLayer()?.batchDraw(); }
        }
      }}
    >
      <Rect x={1.5} y={2} width={w} height={h} fill="black" opacity={0.18} cornerRadius={2} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      {clientColor && (
        <Rect
          x={-2.5} y={-2.5} width={w + 5} height={h + 5}
          fill="transparent"
          stroke={clientColor}
          strokeWidth={2.5}
          cornerRadius={4}
          listening={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      )}
      <Rect
        ref={rectRef}
        width={w}
        height={h}
        fill={fill}
        cornerRadius={2}
        stroke={strokeColor}
        strokeWidth={strokeW}
        opacity={0.92}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
      />
      {/* Highlight halo — bright amber ring instead of Konva shadowBlur, which is
          ~10× cheaper per redraw (no Gaussian blur), so panning a FIFO highlight
          batch of many pallets keeps a steady 60 fps. */}
      {highlighted && (
        <Rect
          x={-3} y={-3}
          width={w + 6} height={h + 6}
          fill="transparent"
          stroke="#fbbf24"
          strokeWidth={2}
          cornerRadius={4}
          listening={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      )}
      <Line points={[2, h * 0.33, w - 2, h * 0.33]} stroke="white" strokeWidth={0.6} opacity={0.4} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      <Line points={[2, h * 0.66, w - 2, h * 0.66]} stroke="white" strokeWidth={0.6} opacity={0.4} listening={false} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
      {w > 30 && h > 15 && (
        <Text
          width={w} height={h}
          align="center" verticalAlign="middle"
          text={variety}
          fontSize={Math.min(11, w / 4)}
          fontStyle="bold"
          fill="white"
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {pallet.z_layer > 0 && (
        <Label x={w - 18} y={-6}>
          <Tag fill="#0f172a" cornerRadius={3} />
          <Text text={`×${pallet.z_layer + 1}`} fontSize={9} fontStyle="bold" fill="white" padding={2} />
        </Label>
      )}
    </Group>
  );
});

/* Senior-friendly help popover — plain-language tour of the warehouse canva.
   Click "?" to open, click anywhere outside or press Esc to close. */
function HelpButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 dark:text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
        title="How does this work?"
        aria-label="Open help"
        aria-expanded={open}
      >
        <HelpCircle size={18} />
      </button>
      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Warehouse canva help"
          className="absolute right-0 top-full mt-2 z-50 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-2xl ring-1 ring-soft p-4 text-sm"
          style={{ transform: "translateZ(0)" }}
        >
          <h3 className="font-bold text-primary text-base mb-2">How to use this warehouse</h3>
          <ul className="space-y-2.5 text-secondary leading-snug">
            <li className="flex gap-2"><span className="text-emerald-500 font-bold">·</span><span><strong className="text-primary">Just looking?</strong> Click and drag the empty floor to look around. Pinch with two fingers to zoom in.</span></li>
            <li className="flex gap-2"><span className="text-sky-500 font-bold">·</span><span>Press <strong className="text-primary">"View only"</strong> to switch to <strong className="text-primary">"Move pallets"</strong>. Drag a pallet to a new spot. Drop one pallet on top of another to stack them.</span></li>
            <li className="flex gap-2"><span className="text-violet-500 font-bold">·</span><span>Press <strong className="text-primary">"Edit floor plan"</strong> to add walls, doors, or storage zones. Pick a tool, then click on the floor to place it.</span></li>
            <li className="flex gap-2"><span className="text-amber-500 font-bold">·</span><span>Lost the warehouse? Click <strong className="text-primary">"Recenter"</strong> in the top bar to bring it back to the middle.</span></li>
            <li className="flex gap-2"><span className="text-rose-500 font-bold">·</span><span>Need to send out old stock first? Click <strong className="text-primary">"FIFO"</strong> to find the oldest pallets.</span></li>
          </ul>
          <p className="text-[11px] text-muted mt-3 pt-3 border-t border-soft">
            Nothing you click can break your data — everything saves automatically and updates other devices live.
          </p>
        </div>
      )}
    </div>
  );
}

function LiveBadge({ status }: { status: "offline" | "connecting" | "live" }) {
  const cfg = {
    live:       { Icon: Wifi,    label: "Live",        cls: "text-emerald-600 bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50",  dot: "bg-emerald-500 animate-pulse" },
    connecting: { Icon: Wifi,    label: "Connecting…", cls: "text-amber-700 bg-amber-50 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50",            dot: "bg-amber-500 animate-pulse" },
    offline:    { Icon: WifiOff, label: "Offline",      cls: "text-slate-600 bg-slate-100 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700",            dot: "bg-slate-400" },
  }[status];
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ring-1 ${cfg.cls}`} title="Realtime sync status">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

function AgingPill({ label, color, count }: { label: string; color: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span className="font-semibold text-secondary">{label}</span>
      <span className="font-bold text-primary tabular-nums">{count}</span>
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Stack confirmation modal                                                       */
/* ──────────────────────────────────────────────────────────────────────────── */

function StackConfirmModal({
  child, parent, isPending, onCancel, onConfirm,
}: {
  child: Pallet; parent: Pallet; isPending: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const newLayer = parent.z_layer + 2;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 p-6 w-[440px] max-w-[92vw]">
        <div className="flex items-center gap-2 mb-1">
          <Layers size={18} className="text-sky-500" />
          <h3 className="font-bold text-lg text-primary">Stack pallet?</h3>
        </div>
        <p className="text-sm text-secondary mb-5">
          You're about to place <strong className="text-primary">{child.pallet_code}</strong> on top of
          {" "}<strong className="text-primary">{parent.pallet_code}</strong>.
          This will form a stack <strong>{newLayer} pallets high</strong>.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
          <PreviewBox label="Child (on top)" pallet={child} />
          <PreviewBox label="Parent (below)" pallet={parent} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 px-4 py-2 rounded-lg ring-1 ring-slate-300 dark:ring-slate-600 text-sm font-semibold text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            <Layers size={14} />
            Stack
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewBox({ label, pallet }: { label: string; pallet: Pallet }) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="font-bold text-primary mt-0.5">{pallet.pallet_code}</p>
      <p className="text-xs text-secondary mt-0.5">
        {pallet.batches[0]?.variety_code || "—"} · {pallet.weight_kg.toLocaleString()} kg
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Pallet Inspector Drawer                                                       */
/* ──────────────────────────────────────────────────────────────────────────── */

function PalletInspector({
  pallet, onClose, onUnstack, canEdit,
}: {
  pallet: Pallet;
  onClose: () => void;
  onUnstack: () => void;
  canEdit: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const aging = pallet.aging_status;
  const headerBg: Record<typeof aging, string> = {
    fresh:    "bg-emerald-500",
    warning:  "bg-amber-500",
    critical: "bg-rose-500",
    expired:  "bg-red-900",
  };

  const { data: movements = [] } = useQuery<Movement[]>({
    queryKey: ["pallet-movements", pallet.id],
    queryFn: () => api.get(`/pallets/${pallet.id}/movements`).then(r => r.data),
    enabled: showHistory,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="w-[340px] shrink-0 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 280px)" }}>
      <div className={`${headerBg[aging]} text-white px-4 py-3 flex items-center justify-between gap-2`}>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-white/80">Pallet</p>
          <p className="font-bold text-lg leading-tight">{pallet.pallet_code}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CopyPalletLinkButton palletCode={pallet.pallet_code} />
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors" title="Close">
            <XIcon size={18} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="badge-green capitalize" style={{ background: AGING_FILL[aging], color: "white", borderColor: AGING_FILL[aging] }}>
            {AGING_LABEL[aging]}
          </span>
          <span className="text-xs text-muted capitalize">{pallet.status.replace(/_/g, " ")}</span>
          {pallet.z_layer > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-white">
              <ArrowUp size={10} /> Layer {pallet.z_layer + 1}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field icon={<Package size={12} />} label="Weight" value={`${pallet.weight_kg.toLocaleString()} kg`} />
          <Field icon={<Wheat size={12} />} label="Sacks" value={`${pallet.sack_count}`} />
          <Field icon={<MapPin size={12} />} label="Position" value={`(${pallet.x_m}m, ${pallet.y_m}m)`} />
          <Field icon={<Building2 size={12} />} label="Layer" value={`${pallet.z_layer}`} />
        </div>

        {canEdit && pallet.z_layer > 0 && (
          <button
            onClick={onUnstack}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-semibold text-primary hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            title="Move this pallet off the stack and back onto the floor"
          >
            <ArrowDown size={14} /> Unstack
          </button>
        )}

        {pallet.batches.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2">Batches ({pallet.batches.length})</p>
            <div className="space-y-2">
              {pallet.batches.map(b => (
                <div key={b.id} className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-bold text-primary">{b.variety_code || "Unknown"}</p>
                    <span className="text-xs text-muted">{b.grade_code || "—"}</span>
                  </div>
                  {b.client_name && (
                    <p className="text-xs text-secondary flex items-center gap-1 mt-0.5">
                      <UserIcon size={11} /> {b.client_name}
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                    <div><span className="text-muted">Weight:</span> <span className="font-medium text-primary">{b.weight_kg.toLocaleString()} kg</span></div>
                    <div><span className="text-muted">Moisture:</span> <span className="font-medium text-primary">{b.moisture_pct ?? "—"}%</span></div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 space-y-1 text-xs">
                    <p className="flex items-center gap-1.5 text-secondary">
                      <Calendar size={11} className="text-slate-400" />
                      Milled: <span className="font-medium text-primary">{b.milling_date}</span>
                    </p>
                    {b.best_before_date && (
                      <p className="flex items-center gap-1.5 text-secondary">
                        <Clock size={11} className="text-slate-400" />
                        Best by: <span className="font-medium text-primary">{b.best_before_date}</span>
                        <span className={`ml-1 font-bold ${b.days_until_expiry < 0 ? "text-rose-600" : b.days_until_expiry <= 14 ? "text-amber-600" : "text-emerald-600"}`}>
                          ({b.days_until_expiry < 0 ? `${-b.days_until_expiry}d expired` : `${b.days_until_expiry}d left`})
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <button
            onClick={() => setShowHistory(s => !s)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-muted hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
          >
            <span className="flex items-center gap-1.5"><History size={11} /> Movement history</span>
            <ChevronRight size={11} className={`transition-transform ${showHistory ? "rotate-90" : ""}`} />
          </button>
          {showHistory && (
            <div className="mt-1 space-y-1">
              {movements.length === 0 ? (
                <p className="text-xs text-muted py-2 px-1">No moves recorded yet.</p>
              ) : (
                movements.map(m => (
                  <div key={m.id} className="text-xs px-3 py-1.5 rounded-md ring-1 ring-slate-200 dark:ring-slate-700/60">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-primary capitalize">{m.movement_type}</span>
                      <span className="text-muted">{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    {m.from_x_m !== null && m.to_x_m !== null && (
                      <p className="text-muted mt-0.5">
                        ({m.from_x_m}, {m.from_y_m}) → ({m.to_x_m}, {m.to_y_m})
                      </p>
                    )}
                    {m.notes && <p className="text-muted mt-0.5">{m.notes}</p>}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">{icon} {label}</p>
      <p className="text-sm font-semibold text-primary mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Heatmap overlay — per-zone utilization color                                  */
/* ──────────────────────────────────────────────────────────────────────────── */

function HeatmapOverlay({ zones, pallets }: { zones: Zone[]; pallets: Pallet[] }) {
  // Sum weight per zone
  const weightByZone = new Map<string, number>();
  for (const p of pallets) {
    if (!p.zone_id) continue;
    weightByZone.set(p.zone_id, (weightByZone.get(p.zone_id) ?? 0) + p.weight_kg);
  }
  const maxZoneKg = Math.max(1, ...Array.from(weightByZone.values()));

  // Color stop: 0..0.5 green, 0.5..0.8 amber, 0.8+ red
  const colorFor = (ratio: number) => {
    if (ratio >= 0.8) return "rgba(244, 63, 94, 0.45)";    // rose-500
    if (ratio >= 0.5) return "rgba(245, 158, 11, 0.45)";   // amber-500
    if (ratio > 0)    return "rgba(16, 185, 129, 0.35)";   // emerald-500
    return "rgba(148, 163, 184, 0.15)";                    // slate
  };

  return (
    <>
      {zones.map(z => {
        const kg = weightByZone.get(z.id) ?? 0;
        const ratio = kg / maxZoneKg;
        const x = z.x_m * PX_PER_METER_DEFAULT;
        const y = z.y_m * PX_PER_METER_DEFAULT;
        const w = z.width_m * PX_PER_METER_DEFAULT;
        const h = z.height_m * PX_PER_METER_DEFAULT;
        const pct = Math.round(ratio * 100);
        return (
          <Group key={`heat-${z.id}`} x={x} y={y} listening={false}>
            <Rect width={w} height={h} fill={colorFor(ratio)} cornerRadius={4} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
            <Label x={w - 50} y={4}>
              <Tag fill="#0f172a" cornerRadius={3} opacity={0.85} />
              <Text
                text={`${kg.toLocaleString()}kg · ${pct}%`}
                fontSize={9}
                fontStyle="bold"
                fill="white"
                padding={4}
              />
            </Label>
          </Group>
        );
      })}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Aging report modal                                                            */
/* ──────────────────────────────────────────────────────────────────────────── */

type AgingReport = {
  branch_name: string;
  as_of: string;
  totals: Record<string, number>;
  total_pallets: number;
  total_weight_kg: number;
  zones: {
    zone_id: string | null; zone_name: string; zone_type: string;
    pallet_count: number; weight_kg: number; utilization_pct: number | null;
    by_aging: Record<string, number>;
  }[];
  oldest_5: {
    pallet_id: string; pallet_code: string; variety_code: string | null;
    milling_date: string; days_old: number; weight_kg: number; status: string;
  }[];
  expired_pallets: {
    pallet_id: string; pallet_code: string; variety_code: string | null;
    days_old: number; weight_kg: number;
  }[];
};

function AgingReportModal({
  branchId, onClose, onSelectPallet,
}: {
  branchId: string;
  onClose: () => void;
  onSelectPallet: (palletId: string) => void;
}) {
  const { data, isLoading } = useQuery<AgingReport>({
    queryKey: ["aging-report", branchId],
    queryFn: () => api.get(`/warehouses/${branchId}/aging-report`).then(r => r.data),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 w-[760px] max-w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileBarChart2 size={18} className="text-amber-500" />
            <h3 className="font-bold text-lg text-primary">Aging Report</h3>
            {data && <span className="text-xs text-muted">· as of {data.as_of}</span>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary" title="Close">
            <XIcon size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          {isLoading || !data ? (
            <div className="flex items-center justify-center py-10 text-secondary gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {/* Totals strip */}
              <div className="grid grid-cols-4 gap-3">
                <TotalTile color={AGING_FILL.fresh}    label="Fresh"    count={data.totals.fresh}    />
                <TotalTile color={AGING_FILL.warning}  label="Warning"  count={data.totals.warning}  />
                <TotalTile color={AGING_FILL.critical} label="Critical" count={data.totals.critical} />
                <TotalTile color={AGING_FILL.expired}  label="Expired"  count={data.totals.expired}  />
              </div>

              {/* Per-zone table */}
              <div>
                <h4 className="font-bold text-primary mb-2 text-sm uppercase tracking-wide">By zone</h4>
                <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-left">
                      <tr>
                        <th className="px-3 py-2 font-bold text-xs text-muted uppercase tracking-wide">Zone</th>
                        <th className="px-3 py-2 font-bold text-xs text-muted uppercase tracking-wide text-right">Pallets</th>
                        <th className="px-3 py-2 font-bold text-xs text-muted uppercase tracking-wide text-right">Weight</th>
                        <th className="px-3 py-2 font-bold text-xs text-muted uppercase tracking-wide text-right">Util.</th>
                        <th className="px-3 py-2 font-bold text-xs text-muted uppercase tracking-wide text-right">Aging mix</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.zones.filter(z => z.pallet_count > 0).map(z => (
                        <tr key={z.zone_id ?? "unassigned"}>
                          <td className="px-3 py-2 font-medium text-primary">{z.zone_name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{z.pallet_count}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{z.weight_kg.toLocaleString()} kg</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">
                            {z.utilization_pct === null ? "—" : `${z.utilization_pct}%`}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex gap-1">
                              {(["fresh", "warning", "critical", "expired"] as const).map(s => (
                                z.by_aging[s] > 0 ? (
                                  <span key={s} className="inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums" style={{ color: AGING_FILL[s] }}>
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: AGING_FILL[s] }} />
                                    {z.by_aging[s]}
                                  </span>
                                ) : null
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Oldest 5 */}
              <div>
                <h4 className="font-bold text-primary mb-2 text-sm uppercase tracking-wide">Top 5 oldest (act first)</h4>
                <div className="space-y-1.5">
                  {data.oldest_5.length === 0 ? (
                    <p className="text-sm text-muted">No batches recorded.</p>
                  ) : (
                    data.oldest_5.map((b, i) => (
                      <button
                        key={b.pallet_id + i}
                        onClick={() => onSelectPallet(b.pallet_id)}
                        className="w-full px-3 py-2 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-primary">{b.pallet_code} <span className="font-normal text-secondary">· {b.variety_code || "—"}</span></p>
                          <p className="text-xs text-muted">milled {b.milling_date} · {b.days_old}d old</p>
                        </div>
                        <span className="text-[10px] uppercase font-bold tabular-nums px-2 py-0.5 rounded-full" style={{ background: `${AGING_FILL[b.status as keyof typeof AGING_FILL] ?? AGING_FILL.fresh}33`, color: AGING_FILL[b.status as keyof typeof AGING_FILL] ?? AGING_FILL.fresh }}>
                          {b.status}
                        </span>
                        <span className="font-semibold tabular-nums text-primary text-sm">{b.weight_kg.toLocaleString()} kg</span>
                        <ChevronRight size={14} className="text-muted shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </div>

              {data.expired_pallets.length > 0 && (
                <div>
                  <h4 className="font-bold text-rose-600 dark:text-rose-400 mb-2 text-sm uppercase tracking-wide">⚠ Expired stock ({data.expired_pallets.length})</h4>
                  <p className="text-xs text-muted mb-2">These pallets are past their best-before date. Sell, repurpose, or discard.</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {data.expired_pallets.map(b => (
                      <button
                        key={b.pallet_id}
                        onClick={() => onSelectPallet(b.pallet_id)}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 text-xs text-left hover:bg-rose-100 dark:hover:bg-rose-950/50 flex items-center justify-between gap-2"
                      >
                        <span className="font-bold text-rose-900 dark:text-rose-200">{b.pallet_code}</span>
                        <span className="text-rose-700 dark:text-rose-300 tabular-nums">{b.days_old}d · {b.weight_kg}kg</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TotalTile({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2.5 bg-slate-50 dark:bg-slate-800/40">
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</p>
      <p className="text-2xl font-extrabold tabular-nums text-primary mt-0.5">{count}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Copy-URL button (for QR / shareable deep links to a pallet)                   */
/* ──────────────────────────────────────────────────────────────────────────── */

export function CopyPalletLinkButton({ palletCode }: { palletCode: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "warehouse");
    url.searchParams.set("pallet", palletCode);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-secondary hover:text-primary transition-colors"
      title="Copy a shareable link to this pallet — print as QR for the physical label"
    >
      {copied ? <Check size={10} /> : <Link2 size={10} />}
      {copied ? "Copied" : "Copy URL"}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Customer filter dropdown                                                      */
/* ──────────────────────────────────────────────────────────────────────────── */

function CustomerFilter({
  customers, selected, onChange,
}: {
  customers: CanvaCustomer[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, [open]);

  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter(n => n !== name));
    else onChange([...selected, name]);
  };
  const label = selected.length === 0 ? "All customers" : `${selected.length} selected`;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 transition-colors ${
          selected.length > 0
            ? "bg-sky-600 text-white ring-sky-600"
            : "ring-slate-300 dark:ring-slate-600 text-secondary hover:bg-slate-100 dark:hover:bg-slate-700/40"
        }`}
        title="Filter pallets by customer"
      >
        <Filter size={13} /> {label}
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            className="fixed w-72 max-h-[60vh] overflow-y-auto rounded-xl shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 z-[101] p-1.5"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="px-2.5 py-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Owners ({customers.length})</span>
              {selected.length > 0 && (
                <button onClick={() => onChange([])} className="text-[10px] font-bold text-sky-600 hover:text-sky-700">Clear</button>
              )}
            </div>
            {customers.map(c => {
              const isSel = selected.includes(c.client_name);
              return (
                <button
                  key={c.client_name}
                  onClick={() => toggle(c.client_name)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                    isSel ? "bg-sky-50 dark:bg-sky-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <span className="inline-block w-3 h-3 rounded-sm shrink-0 ring-1 ring-slate-300 dark:ring-slate-600" style={{ background: c.color_hex }} />
                  <span className="flex-1 min-w-0 truncate font-medium text-primary">{c.client_name}</span>
                  <span className="text-[10px] text-muted tabular-nums shrink-0">
                    {c.pallet_count} · {c.weight_kg.toLocaleString()}kg
                  </span>
                  {isSel && <Check size={13} className="text-sky-600 dark:text-sky-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Builder toolbox — appears below toolbar in layout mode                        */
/* ──────────────────────────────────────────────────────────────────────────── */

const ZONE_TYPE_META: Record<string, { label: string; structural: boolean }> = {
  general:          { label: "General Storage",  structural: false },
  milling:          { label: "Milling Floor",    structural: false },
  premium_storage:  { label: "Premium Storage",  structural: false },
  customer_storage: { label: "Customer Holding", structural: false },
  paddy_intake:     { label: "Paddy Intake",     structural: false },
  drying:           { label: "Drying Area",      structural: false },
  shipping_dock:    { label: "Shipping Dock",    structural: false },
  office:           { label: "Office",           structural: false },
  wall:             { label: "Wall",             structural: true },
  door:             { label: "Door",             structural: true },
  walkway:          { label: "Walkway",          structural: true },
  loading_dock:     { label: "Loading Dock",     structural: true },
};

function BuilderToolbox({
  layout, pendingZoneType, setPendingZoneType, showLayoutSize, setShowLayoutSize,
  onResize, onRename, onGridChange,
}: {
  layout: { width_m: number; height_m: number; grid_size_m: number; name: string };
  pendingZoneType: string | null;
  setPendingZoneType: (t: string | null) => void;
  showLayoutSize: boolean;
  setShowLayoutSize: (v: boolean) => void;
  onResize: (w: number, h: number) => void;
  onRename: (name: string) => void;
  onGridChange: (g: number) => void;
}) {
  const [w, setW] = useState(layout.width_m);
  const [h, setH] = useState(layout.height_m);
  const [name, setName] = useState(layout.name);
  const [grid, setGrid] = useState(layout.grid_size_m);
  useEffect(() => { setW(layout.width_m); setH(layout.height_m); setName(layout.name); setGrid(layout.grid_size_m); }, [layout.width_m, layout.height_m, layout.name, layout.grid_size_m]);

  const storage = STORAGE_ZONE_TYPES;
  // "loading_dock" intentionally omitted from the structural toolbox — "door"
  // already covers the dock/pinto use case in practice.
  const structural = ["wall", "door", "walkway"];

  const ToolBtn = ({ t }: { t: string }) => {
    const isStructural = STRUCTURAL_TYPES.has(t);
    const active = pendingZoneType === t;
    const Icon = t === "wall" ? Square : t === "door" ? DoorOpen : t === "walkway" ? Move : Plus;
    return (
      <button
        onClick={() => setPendingZoneType(active ? null : t)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
          active
            ? (isStructural ? "bg-slate-900 text-white" : "bg-violet-600 text-white")
            : "ring-1 ring-slate-300 dark:ring-slate-600 text-secondary hover:bg-slate-100 dark:hover:bg-slate-700/40"
        }`}
        title={`Click then click the floor to drop a ${ZONE_TYPE_META[t]?.label}`}
      >
        <Icon size={11} />
        {ZONE_TYPE_META[t]?.label ?? t}
      </button>
    );
  };

  return (
    <div className="card !p-3 bg-violet-50/60 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800/60 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <Hammer size={14} className="text-violet-600 dark:text-violet-400" />
        <span className="text-xs font-bold uppercase tracking-wide text-violet-900 dark:text-violet-200">Floor-plan editor</span>
        <span className="text-xs text-violet-700/70 dark:text-violet-300/80">Pick a tool below, then click anywhere on the floor to place it. Click a zone to select it — then drag to move or use the handles to resize.</span>
        <button
          onClick={() => setShowLayoutSize(!showLayoutSize)}
          className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
            showLayoutSize ? "bg-violet-600 text-white" : "ring-1 ring-violet-400 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40"
          }`}
        >
          <Maximize2 size={12} /> Dimensions
        </button>
      </div>

      {showLayoutSize && (
        <div className="flex items-end gap-2 flex-wrap pt-2 border-t border-violet-200 dark:border-violet-800/40">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-0.5">Name</label>
            <input
              className="input !py-1 !text-xs w-48"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (name && name !== layout.name) onRename(name); }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-0.5">Width (m)</label>
            <input type="number" min="5" max="200" step="0.5" className="input !py-1 !text-xs w-20" value={w} onChange={(e) => setW(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-0.5">Height (m)</label>
            <input type="number" min="5" max="200" step="0.5" className="input !py-1 !text-xs w-20" value={h} onChange={(e) => setH(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-0.5">Grid (m)</label>
            <input type="number" min="0.1" max="2" step="0.1" className="input !py-1 !text-xs w-20" value={grid}
                   onChange={(e) => setGrid(Number(e.target.value))}
                   onBlur={() => { if (grid && grid !== layout.grid_size_m) onGridChange(grid); }} />
          </div>
          <button
            onClick={() => onResize(w, h)}
            disabled={w === layout.width_m && h === layout.height_m}
            className="px-3 py-1 rounded-md bg-violet-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-violet-700"
          >
            Apply
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-violet-200 dark:border-violet-800/40">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted mr-1">Zones:</span>
        {storage.map(t => <ToolBtn key={t} t={t} />)}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted mr-1">Structural:</span>
        {structural.map(t => <ToolBtn key={t} t={t} />)}
      </div>

      {pendingZoneType && (
        <div className="text-xs text-violet-800 dark:text-violet-200 px-2 py-1 bg-violet-100 dark:bg-violet-900/40 rounded">
          Tool armed: <strong>{ZONE_TYPE_META[pendingZoneType]?.label}</strong>. Click anywhere on the floor to place it. Press the button again or click another tool to cancel.
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Zone Editor drawer                                                            */
/* ──────────────────────────────────────────────────────────────────────────── */

function ZoneEditor({
  zone, onClose, onChange, onDelete,
}: {
  zone: Zone;
  onClose: () => void;
  onChange: (patch: any) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(zone.name);
  const [zoneType, setZoneType] = useState(zone.zone_type);
  const [color, setColor] = useState(zone.color_hex);
  const [notes, setNotes] = useState(zone.notes ?? "");
  useEffect(() => {
    setName(zone.name); setZoneType(zone.zone_type); setColor(zone.color_hex); setNotes(zone.notes ?? "");
  }, [zone.id, zone.name, zone.zone_type, zone.color_hex, zone.notes]);

  const isStructural = STRUCTURAL_TYPES.has(zoneType);
  const allTypes = [...STORAGE_ZONE_TYPES, "wall", "door", "walkway", "loading_dock"];

  return (
    <div className="w-[320px] shrink-0 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 280px)" }}>
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Zone</p>
          <p className="font-bold text-primary leading-tight">{zone.name}</p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-primary" title="Close">
          <XIcon size={18} />
        </button>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Name</label>
          <input
            className="input !py-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name && name !== zone.name) onChange({ name }); }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Type</label>
          <select
            className="input !py-1.5"
            value={zoneType}
            onChange={(e) => { setZoneType(e.target.value); onChange({ zone_type: e.target.value }); }}
          >
            <optgroup label="Storage">
              {STORAGE_ZONE_TYPES.map(t => <option key={t} value={t}>{ZONE_TYPE_META[t]?.label ?? t}</option>)}
            </optgroup>
            <optgroup label="Structural">
              {["wall", "door", "walkway"].map(t => <option key={t} value={t}>{ZONE_TYPE_META[t]?.label ?? t}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} onBlur={() => onChange({ color_hex: color })} className="w-12 h-8 rounded ring-1 ring-slate-300" />
            <input className="input !py-1 !text-xs font-mono" value={color} onChange={(e) => setColor(e.target.value)} onBlur={() => onChange({ color_hex: color })} />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Notes</label>
          <textarea
            rows={2}
            className="input !py-1.5 !text-xs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if ((notes ?? "") !== (zone.notes ?? "")) onChange({ notes }); }}
            placeholder="Optional"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Field icon={<Square size={12} />} label="Position" value={`(${zone.x_m}, ${zone.y_m})`} />
          <Field icon={<Maximize2 size={12} />} label="Size" value={`${zone.width_m} × ${zone.height_m} m`} />
        </div>
        {isStructural && (
          <div className="rounded-lg bg-slate-100 dark:bg-slate-800/60 px-3 py-2 text-xs text-secondary">
            <Square size={10} className="inline mr-1 -mt-0.5" />
            Structural element — cannot hold pallets.
          </div>
        )}

        <button
          onClick={() => { if (confirm(`Delete "${zone.name}"?`)) onDelete(); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 text-sm font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
        >
          <Trash2 size={14} /> Delete zone
        </button>
      </div>
    </div>
  );
}
