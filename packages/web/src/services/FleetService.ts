import api from "./api";

export type Driver = {
  id: string;
  name: string;
  phone: string | null;
  license_no: string | null;
  is_payroll: boolean;
  employee_id: string | null;
  employee_name: string | null;
  is_active: boolean;
};

export type Truck = {
  id: string;
  plate_number: string;
  truck_type: string | null;
  fuel_consumption_l_per_100km: number | null;
  default_driver_id: string | null;
  default_driver_name: string | null;
  notes: string | null;
  is_active: boolean;
};

export type DispatchTrip = {
  id: string;
  trip_no: string;
  truck_id: string;
  truck_plate: string | null;
  truck_type: string | null;
  driver_id: string;
  driver_name: string | null;
  order_id: string | null;
  order_no: string | null;
  dispatch_date: string;
  fuel_used_l: number | null;
  destination: string | null;
  notes: string | null;
  status: string;
  // When the status last changed, and until when a departed or delivered trip can still be edited.
  status_changed_at?: string | null;
  edit_until?: string | null;
};

export const TRUCK_TYPES = [
  { value: "forward", label: "Forward" },
  { value: "canter", label: "Canter" },
  { value: "closed_van", label: "Closed Van" },
  { value: "drop_side", label: "Drop Side" },
  { value: "boom_truck", label: "Boom Truck" },
  { value: "reefer", label: "Reefer" },
  { value: "tanker", label: "Tanker" },
  { value: "pickup", label: "Pickup" },
  { value: "other", label: "Other" },
];

export const TRIP_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "in_transit", label: "In Transit" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export class FleetService {
  constructor(private http = api) {}

  // ── Drivers ──────────────────────────────────────────────────────────────

  listDrivers(includeInactive = false): Promise<Driver[]> {
    return this.http.get(`/fleet/drivers?include_inactive=${includeInactive}`).then((r) => r.data);
  }

  createDriver(body: Record<string, unknown>): Promise<Driver> {
    return this.http.post("/fleet/drivers", body).then((r) => r.data);
  }

  updateDriver(id: string, body: Record<string, unknown>): Promise<Driver> {
    return this.http.put(`/fleet/drivers/${id}`, body).then((r) => r.data);
  }

  // ── Trucks ────────────────────────────────────────────────────────────────

  listTrucks(includeInactive = false): Promise<Truck[]> {
    return this.http.get(`/fleet/trucks?include_inactive=${includeInactive}`).then((r) => r.data);
  }

  createTruck(body: Record<string, unknown>): Promise<Truck> {
    return this.http.post("/fleet/trucks", body).then((r) => r.data);
  }

  updateTruck(id: string, body: Record<string, unknown>): Promise<Truck> {
    return this.http.put(`/fleet/trucks/${id}`, body).then((r) => r.data);
  }

  // ── Trips ─────────────────────────────────────────────────────────────────

  listTrips(limit = 100): Promise<DispatchTrip[]> {
    return this.http.get(`/fleet/trips?limit=${limit}`).then((r) => r.data);
  }

  createTrip(body: Record<string, unknown>): Promise<DispatchTrip> {
    return this.http.post("/fleet/trips", body).then((r) => r.data);
  }

  updateTrip(id: string, body: Record<string, unknown>): Promise<DispatchTrip> {
    return this.http.put(`/fleet/trips/${id}`, body).then((r) => r.data);
  }
}

export const fleetService = new FleetService();
