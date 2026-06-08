// LocationsService — typed API client for saved locations + geocoding (Phase F).
// Wraps the shared axios instance so the location hooks stop scattering raw
// api calls. Domain types live with the hooks (useLocations.ts).
import api from "./api";

export class LocationsService {
  constructor(private http = api) {}

  list(): Promise<any[]> {
    return this.http.get("/locations").then((r) => r.data);
  }

  create(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/locations", body).then((r) => r.data);
  }

  setDefault(id: string): Promise<any> {
    return this.http.patch(`/locations/${id}/set-default`).then((r) => r.data);
  }

  remove(id: string): Promise<any> {
    return this.http.delete(`/locations/${id}`).then((r) => r.data);
  }

  search(query: string): Promise<any[]> {
    return this.http.get(`/locations/search?q=${encodeURIComponent(query)}`).then((r) => r.data);
  }
}

export const locationsService = new LocationsService();
