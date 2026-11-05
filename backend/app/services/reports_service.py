"""ReportsService — read-only financial/operational analytics (Phase 3).

Reports aggregate across many domains (sales, costs, paddy, milling), so the
query logic lives here rather than in a per-entity repository. Read-only: no
transactions.
"""

from __future__ import annotations

import calendar
from datetime import date
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.branch_scope import viewed_branch
from ..core.timezones import local_today
from ..models.milling import ByproductInventory, MilledRiceInventory, MillingBatch
from ..models.paddy import PalayInventory, PalayPurchase
from ..models.sales import Invoice, SalesOrder
from ..services.base import BaseService
from ..services.profit_service import ProfitService


class ReportsService(BaseService):
    def __init__(self, db: Session, current_user: Any) -> None:
        super().__init__(db, current_user)

    @property
    def _company_id(self):
        return self.current_user.company_id

    def _viewed(self, model: Any) -> list:
        """The filter keeping a report to the branch the Boss is looking at (none for all)."""
        branch = viewed_branch(self.db)
        return [model.branch_id == branch] if branch is not None else []

    def profit_and_loss(self, period_start: date, period_end: date) -> dict:
        """The Profit page's own figures (ProfitService.period), so the Dashboard, this
        page and the Profit page never disagree. Cost of goods is what the goods sold
        cost; expenses are all of the period's. Sales of a good with nothing on record
        to cost it against (none bought or milled lately) earn no profit here, as on
        the Profit page, and are shown apart."""
        revenue = float(
            self.db.query(func.sum(SalesOrder.total_amount))
            .filter(
                SalesOrder.company_id == self._company_id,
                SalesOrder.order_date >= period_start,
                SalesOrder.order_date <= period_end,
                SalesOrder.status.in_(["invoiced", "paid"]),
                *self._viewed(SalesOrder),
            )
            .scalar()
            or 0
        )
        period = ProfitService(self.db, self.current_user).period(period_start, period_end)
        costed = [g for g in period["goods"] if g["cost"] is not None]
        cogs = sum(g["cost"] for g in costed)
        costed_sales = sum(g["sales"] for g in costed)
        expenses = period["expenses"]
        net_profit = period["total_profit"]
        gross_profit = net_profit + expenses
        return {
            "period_start": period_start,
            "period_end": period_end,
            "revenue": revenue,
            "uncosted_sales": max(round(revenue - costed_sales, 2), 0.0),
            "cost_of_goods": cogs,
            "gross_profit": gross_profit,
            "operating_expenses": expenses,
            "net_profit": net_profit,
            "gross_margin_pct": round(gross_profit / costed_sales * 100, 2) if costed_sales else 0,
        }

    def inventory_valuation(self) -> dict:
        palay = (
            self.db.query(PalayInventory)
            .filter(PalayInventory.company_id == self._company_id, *self._viewed(PalayInventory))
            .all()
        )
        milled = (
            self.db.query(MilledRiceInventory)
            .filter(MilledRiceInventory.company_id == self._company_id, *self._viewed(MilledRiceInventory))
            .all()
        )
        byp = (
            self.db.query(ByproductInventory)
            .filter(ByproductInventory.company_id == self._company_id, *self._viewed(ByproductInventory))
            .all()
        )
        return {
            "palay": [
                {"variety_id": str(i.variety_id), "grade_id": str(i.grade_id), "quantity_kg": float(i.quantity_kg)}
                for i in palay
            ],
            "milled_rice": [
                {"variety_id": str(i.variety_id), "grade_name": i.grade_name, "quantity_kg": float(i.quantity_kg)}
                for i in milled
            ],
            "byproducts": [{"type": i.byproduct_type, "quantity_kg": float(i.quantity_kg)} for i in byp],
        }

    def compliance_report(self, report_type: str, period_start: date, period_end: date) -> dict:
        batches = (
            self.db.query(MillingBatch)
            .filter(
                MillingBatch.company_id == self._company_id,
                func.date(MillingBatch.start_datetime) >= period_start,
                func.date(MillingBatch.start_datetime) <= period_end,
                *self._viewed(MillingBatch),
            )
            .all()
        )
        purchases = (
            self.db.query(PalayPurchase)
            .filter(
                PalayPurchase.company_id == self._company_id,
                PalayPurchase.purchase_date >= period_start,
                PalayPurchase.purchase_date <= period_end,
                *self._viewed(PalayPurchase),
            )
            .all()
        )
        return {
            "report_type": report_type,
            "period_start": period_start,
            "period_end": period_end,
            "total_batches": len(batches),
            "total_purchases": len(purchases),
            "total_palay_procured_kg": sum(
                sum((i.gross_weight_kg - i.tare_weight_kg) for i in p.items) for p in purchases
            ),
        }

    def revenue_annual(self, year: int) -> list[dict]:
        """Return monthly revenue totals for the given calendar year."""
        months = []
        for month in range(1, 13):
            _, last_day = calendar.monthrange(year, month)
            period_start = date(year, month, 1)
            period_end = date(year, month, last_day)
            revenue = (
                self.db.query(func.sum(SalesOrder.total_amount))
                .filter(
                    SalesOrder.company_id == self._company_id,
                    SalesOrder.order_date >= period_start,
                    SalesOrder.order_date <= period_end,
                    SalesOrder.status.in_(["invoiced", "paid"]),
                    *self._viewed(SalesOrder),
                )
                .scalar()
                or 0
            )
            months.append(
                {
                    "month": month,
                    "month_name": date(year, month, 1).strftime("%b"),
                    "revenue": float(revenue),
                }
            )
        return months

    def ar_aging(self, *, today: date | None = None) -> dict:
        """Outstanding receivables by days past due, as of ``today``: by default
        the mill's local date, not the server's UTC one."""
        invoices = (
            self.db.query(Invoice)
            .filter(
                Invoice.company_id == self._company_id,
                Invoice.status.in_(["unpaid", "partial", "overdue"]),
                *self._viewed(Invoice),
            )
            .all()
        )
        if today is None:
            company = getattr(self.current_user, "company", None)
            today = local_today(getattr(company, "timezone", None))
        buckets: dict[str, Any] = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "over_90": 0}
        for inv in invoices:
            outstanding = float(inv.total_amount - inv.paid_amount)
            # An invoice with no due date (created before due dates were
            # defaulted) is due on its invoice date. These used to fall into
            # no bucket at all, so they vanished from the report.
            days = (today - (inv.due_date or inv.invoice_date)).days
            if days <= 0:
                buckets["current"] += outstanding
            elif days <= 30:
                buckets["1_30"] += outstanding
            elif days <= 60:
                buckets["31_60"] += outstanding
            elif days <= 90:
                buckets["61_90"] += outstanding
            else:
                buckets["over_90"] += outstanding
        return buckets
