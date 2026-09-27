"""Reports domain HTTP controllers — thin routing over ReportsService (Phase 3)."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..services.reports_service import ReportsService

router = APIRouter(dependencies=[Depends(require_section_access("reports"))])


def get_reports_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ReportsService:
    return ReportsService(db, current_user)


@router.get("/pnl")
def profit_and_loss(
    period_start: date = Query(...),
    period_end: date = Query(...),
    batch_id: str | None = None,
    svc: ReportsService = Depends(get_reports_service),
):
    return svc.profit_and_loss(period_start, period_end, batch_id)


@router.get("/inventory-valuation", dependencies=[Depends(require_feature("reports_advanced"))])
def inventory_valuation(svc: ReportsService = Depends(get_reports_service)):
    return svc.inventory_valuation()


@router.get("/compliance/{report_type}", dependencies=[Depends(require_feature("compliance_reports"))])
def compliance_report(
    report_type: str,
    period_start: date = Query(...),
    period_end: date = Query(...),
    svc: ReportsService = Depends(get_reports_service),
):
    return svc.compliance_report(report_type, period_start, period_end)


@router.get("/revenue-annual")
def revenue_annual(
    year: int = Query(default=None),
    svc: ReportsService = Depends(get_reports_service),
):
    if year is None:
        year = date.today().year
    return svc.revenue_annual(year)


@router.get("/ar-aging", dependencies=[Depends(require_feature("reports_advanced"))])
def ar_aging(svc: ReportsService = Depends(get_reports_service)):
    return svc.ar_aging()
