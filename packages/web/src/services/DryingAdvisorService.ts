// DryingAdvisorService — typed API client for the Enterprise-only palay
// Drying Advisor. Mirrors WeatherService's coords-or-IP-fallback contract.
import api from "./api";

export type DryingVerdict = "good" | "caution" | "poor";

export type DryingAdvisory = {
  verdict: DryingVerdict;
  headline: string;
  reasoning: string;
  best_window: string | null;
  generated_at: string;
  location: { lat: number; lon: number; label: string | null };
  cached: boolean;
};

export class DryingAdvisorService {
  constructor(private http = api) {}

  get(coords?: { lat: number; lon: number } | null): Promise<DryingAdvisory> {
    const url = coords
      ? `/drying-advisory?lat=${coords.lat}&lon=${coords.lon}`
      : "/drying-advisory";
    return this.http.get(url).then((r) => r.data);
  }
}

export const dryingAdvisorService = new DryingAdvisorService();
