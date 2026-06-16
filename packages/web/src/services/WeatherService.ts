// WeatherService — typed API client for the weather endpoint (Phase F).
// Wraps the shared axios instance. When coords are supplied the backend trusts
// them (precise); otherwise it resolves location from the request IP.
import api from "./api";

export class WeatherService {
  constructor(private http = api) {}

  get(coords?: { lat: number; lon: number } | null): Promise<any> {
    const url = coords ? `/weather?lat=${coords.lat}&lon=${coords.lon}` : "/weather";
    return this.http.get(url).then((r) => r.data);
  }

  getForecast(coords?: { lat: number; lon: number } | null): Promise<any> {
    const url = coords
      ? `/weather/forecast?lat=${coords.lat}&lon=${coords.lon}`
      : "/weather/forecast";
    return this.http.get(url).then((r) => r.data);
  }
}

export const weatherService = new WeatherService();
