import { useQuery } from "@tanstack/react-query";
import { canvaService } from "../../services/CanvaService";

/** One batch on a pallet — mirrors the backend `_serialize_batch` shape. */
export type RackBatch = {
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

/** A single pallet row as shown in the rack/grid list — slim, list-oriented. */
export type RackPallet = {
  id: string;
  pallet_code: string;
  variety_code: string | null;
  variety_name: string | null;
  days_old: number;
  milling_date: string;
  aging_status: "fresh" | "warning" | "critical" | "expired";
  weight_kg: number;
  sack_count: number;
  client_name: string | null;
  batches: RackBatch[];
};

export type AgingCounts = {
  fresh: number;
  warning: number;
  critical: number;
  expired: number;
};

/** A storage zone presented as a "rack" with its own pallets + occupancy. */
export type Rack = {
  zone_id: string;
  name: string;
  zone_type: string;
  color_hex: string;
  capacity_kg: number | null;
  used_kg: number;
  occupancy_pct: number | null;
  pallet_count: number;
  by_aging: AgingCounts;
  pallets: RackPallet[];
};

export type RackView = {
  layout: { id: string; name: string; branch_name: string };
  summary: {
    total_pallets: number;
    total_weight_kg: number;
    capacity_kg: number | null;
    occupancy_pct: number | null;
    by_aging: AgingCounts;
  };
  racks: Rack[];
  unzoned: RackPallet[];
};

/** Fetches the grouped rack/grid view for a branch's default (or given) layout.
 *  Reacts to branch changes via the queryKey; only runs once a branch is known. */
export function useRackView(branchId?: string, layoutId?: string) {
  return useQuery<RackView>({
    queryKey: ["rack-view", branchId, layoutId ?? "default"],
    queryFn: () => canvaService.getRackView(branchId!, layoutId),
    enabled: !!branchId,
  });
}
