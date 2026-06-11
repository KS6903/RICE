// ReportsService — typed API client for the reports domain (Phase F).
import api from "./api";

export class ReportsService {
  constructor(private http = api) {}

  getPnl(periodStart: string, periodEnd: string): Promise<any> {
    return this.http
      .get(`/reports/pnl?period_start=${periodStart}&period_end=${periodEnd}`)
      .then((r) => r.data);
  }

  getArAging(): Promise<any> {
    return this.http.get("/reports/ar-aging").then((r) => r.data);
  }

  getInventoryValuation(): Promise<any> {
    return this.http.get("/reports/inventory-valuation").then((r) => r.data);
  }

  getRevenueAnnual(year?: number): Promise<{ month: number; month_name: string; revenue: number }[]> {
    const y = year ?? new Date().getFullYear();
    return this.http.get(`/reports/revenue-annual?year=${y}`).then((r) => r.data);
  }
}

export const reportsService = new ReportsService();
