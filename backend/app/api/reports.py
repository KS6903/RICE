from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import date
from ..core.database import get_db
from ..core.security import get_current_user, require_feature
from ..models.sales import SalesOrder, SalesOrderItem, Invoice, Payment
from ..models.costs import Expense
from ..models.milling import MillingBatch, MillingBatchInput, MillingBatchOutput
from ..models.paddy import PalayPurchase, PalayPurchaseItem

router = APIRouter()


@router.get("/pnl")
def profit_and_loss(
    period_start: date = Query(...),
    period_end: date = Query(...),
    batch_id: str | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Revenue: sum of paid/invoiced sales orders in period
    rev_q = db.query(func.sum(SalesOrder.total_amount)).filter(
        SalesOrder.company_id == current_user.company_id,
        SalesOrder.order_date >= period_start,
        SalesOrder.order_date <= period_end,
        SalesOrder.status.in_(["invoiced", "paid"]),
    )
    revenue = rev_q.scalar() or 0

    # Cost of goods: palay purchases in period
    cogs_q = db.query(func.sum(PalayPurchaseItem.price_per_cavan * PalayPurchaseItem.cavan_count)).join(
        PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id
    ).filter(
        PalayPurchase.company_id == current_user.company_id,
        PalayPurchase.purchase_date >= period_start,
        PalayPurchase.purchase_date <= period_end,
    )
    cogs = cogs_q.scalar() or 0

    # Operating expenses
    exp_q = db.query(func.sum(Expense.amount)).filter(
        Expense.company_id == current_user.company_id,
        Expense.expense_date >= period_start,
        Expense.expense_date <= period_end,
    )
    if batch_id:
        exp_q = exp_q.filter(Expense.batch_id == batch_id)
    expenses = exp_q.scalar() or 0

    gross_profit = revenue - cogs
    net_profit = gross_profit - expenses

    return {
        "period_start": period_start,
        "period_end": period_end,
        "revenue": float(revenue),
        "cost_of_goods": float(cogs),
        "gross_profit": float(gross_profit),
        "operating_expenses": float(expenses),
        "net_profit": float(net_profit),
        "gross_margin_pct": round(float(gross_profit / revenue * 100), 2) if revenue else 0,
    }


@router.get("/inventory-valuation", dependencies=[Depends(require_feature("reports_advanced"))])
def inventory_valuation(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    from ..models.milling import MilledRiceInventory, ByproductInventory
    from ..models.paddy import PalayInventory
    palay = db.query(PalayInventory).filter(PalayInventory.company_id == current_user.company_id).all()
    milled = db.query(MilledRiceInventory).filter(MilledRiceInventory.company_id == current_user.company_id).all()
    byp = db.query(ByproductInventory).filter(ByproductInventory.company_id == current_user.company_id).all()
    return {
        "palay": [{"variety_id": str(i.variety_id), "grade_id": str(i.grade_id), "quantity_kg": float(i.quantity_kg)} for i in palay],
        "milled_rice": [{"variety_id": str(i.variety_id), "grade_name": i.grade_name, "quantity_kg": float(i.quantity_kg)} for i in milled],
        "byproducts": [{"type": i.byproduct_type, "quantity_kg": float(i.quantity_kg)} for i in byp],
    }


@router.get("/compliance/{report_type}", dependencies=[Depends(require_feature("compliance_reports"))])
def compliance_report(report_type: str, period_start: date = Query(...), period_end: date = Query(...), current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    # Returns raw data for NFA/DA reports
    batches = db.query(MillingBatch).filter(
        MillingBatch.company_id == current_user.company_id,
        func.date(MillingBatch.start_datetime) >= period_start,
        func.date(MillingBatch.start_datetime) <= period_end,
    ).all()
    purchases = db.query(PalayPurchase).filter(
        PalayPurchase.company_id == current_user.company_id,
        PalayPurchase.purchase_date >= period_start,
        PalayPurchase.purchase_date <= period_end,
    ).all()
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


@router.get("/ar-aging", dependencies=[Depends(require_feature("reports_advanced"))])
def ar_aging(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    from datetime import datetime, timezone
    invoices = db.query(Invoice).filter(
        Invoice.company_id == current_user.company_id,
        Invoice.status.in_(["unpaid", "partial", "overdue"])
    ).all()
    today = date.today()
    buckets = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "over_90": 0}
    for inv in invoices:
        outstanding = float(inv.total_amount - inv.paid_amount)
        if inv.due_date:
            days = (today - inv.due_date).days
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
