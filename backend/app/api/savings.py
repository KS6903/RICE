"""Savings page HTTP controllers.

On the Pro and Enterprise plans, like the Profit calculator, and the same section: real
costs and margins, so the Boss's alone. ``price_router`` is the one exception: the sale
forms ask it whether a price is under cost, and anyone who can sell may ask.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..services.savings_service import SavingsService
from .profit import require_boss

router = APIRouter(
    dependencies=[
        Depends(require_feature("profit")),
        Depends(require_section_access("profit")),
        Depends(require_boss),
    ]
)
price_router = APIRouter(dependencies=[Depends(require_section_access("sales"))])
# The purchase form asks what a farmer owes in vale: anyone who buys palay may ask.
paddy_router = APIRouter(dependencies=[Depends(require_section_access("paddy"))])


class SettingsIn(BaseModel):
    pay_deductions: bool | None = None
    weight_lock: bool | None = None
    mrr_alert_pct: float | None = Field(None, ge=40, le=80)
    broken_alert_pct: float | None = Field(None, ge=1, le=60)
    unaccounted_alert_pct: float | None = Field(None, ge=0, le=20)
    head_low_pct: float | None = Field(None, ge=0, le=100)
    bran_low_pct: float | None = Field(None, ge=0, le=100)
    bran_high_pct: float | None = Field(None, ge=0, le=100)
    hull_low_pct: float | None = Field(None, ge=0, le=100)
    hull_high_pct: float | None = Field(None, ge=0, le=100)
    binlid_high_pct: float | None = Field(None, ge=0, le=100)
    broken_spike_points: float | None = Field(None, ge=0, le=50)
    wholesale_price: float | None = Field(None, ge=0, le=1_000)
    block_below_cost: bool | None = None
    hold_moisture_over: float | None = Field(None, ge=0, le=100)
    auto_hold_readings: bool | None = None
    fresh_days: dict[str, int] | None = None
    break_even_utilization_pct: float | None = Field(None, ge=1, le=100)
    optimal_low_pct: float | None = Field(None, ge=1, le=100)
    optimal_high_pct: float | None = Field(None, ge=1, le=100)
    working_days_per_week: int | None = Field(None, ge=1, le=7)
    tariff_pct: float | None = Field(None, ge=0, le=200)
    cif_usd_per_ton: float | None = Field(None, ge=0, le=100_000)
    usd_php: float | None = Field(None, ge=0, le=1_000)
    landed_other_per_kg: float | None = Field(None, ge=0, le=1_000)
    packaging_per_sack: float | None = Field(None, ge=0, le=10_000)
    kg_per_sack: float | None = Field(None, gt=0, le=200)
    bran_fresh_days: int | None = Field(None, ge=1, le=365)


class HoldIn(BaseModel):
    pallet_id: uuid.UUID | None = None
    stock_type: Literal["milled_rice", "byproduct", "palay"] = "milled_rice"
    variety_id: uuid.UUID | None = None
    grade_name: str | None = Field(None, max_length=30)
    byproduct_type: str | None = Field(None, max_length=20)
    weight_kg: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=3)
    reason: Literal["moisture", "pests", "mould", "contaminant", "other"]
    note: str | None = Field(None, max_length=500)


class ClearIn(BaseModel):
    note: str | None = Field(None, max_length=500)


class ReadingIn(BaseModel):
    zone_id: uuid.UUID
    humidity_pct: Decimal | None = Field(None, ge=0, le=100)
    temp_c: Decimal | None = Field(None, ge=-20, le=99)
    note: str | None = Field(None, max_length=300)


class PickFirstIn(BaseModel):
    reason: str | None = Field(None, max_length=300)


class AdvanceIn(BaseModel):
    supplier_id: uuid.UUID
    advance_date: date
    kind: Literal["cash", "inputs"] = "cash"
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    note: str | None = Field(None, max_length=500)


class PaymentIn(BaseModel):
    supplier_id: uuid.UUID
    paid_on: date
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    note: str | None = Field(None, max_length=300)


class PalletDateIn(BaseModel):
    milling_date: date


class PriceLine(BaseModel):
    item_type: Literal["milled_rice", "byproduct", "palay"] = "milled_rice"
    byproduct_type: str | None = Field(None, max_length=20)
    variety_id: uuid.UUID | None = None
    price: float = Field(ge=0)


class PriceCheckIn(BaseModel):
    items: list[PriceLine] = Field(max_length=100)


def get_service(db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> SavingsService:
    return SavingsService(db, current_user)


@router.get("/overview")
def overview(svc: SavingsService = Depends(get_service)):
    return svc.overview()


@router.get("/settings")
def get_settings(svc: SavingsService = Depends(get_service)):
    return svc.get_settings()


@router.put("/settings")
def set_settings(body: SettingsIn, svc: SavingsService = Depends(get_service)):
    # exclude_unset: sending null clears a typed figure, such as the CIF price.
    return svc.set_settings(body.model_dump(exclude_unset=True))


@router.get("/max-buy")
def max_buy(svc: SavingsService = Depends(get_service)):
    return svc.max_buy()


@router.get("/batches")
def batches(svc: SavingsService = Depends(get_service)):
    return svc.batches()


@router.get("/batches/{batch_id}/trace")
def trace(batch_id: uuid.UUID, svc: SavingsService = Depends(get_service)):
    return svc.trace(batch_id)


@router.get("/warehouse")
def warehouse(svc: SavingsService = Depends(get_service)):
    return svc.warehouse()


@router.get("/movements")
def movements(stock_type: str | None = Query(None, max_length=20), svc: SavingsService = Depends(get_service)):
    return svc.movements(stock_type=stock_type)


@router.post("/pallets/{pallet_id}/pick-first")
def pick_first(pallet_id: uuid.UUID, body: PickFirstIn, svc: SavingsService = Depends(get_service)):
    return svc.pick_first(pallet_id, body.reason)


@router.post("/pallets/{pallet_id}/date")
def set_pallet_date(pallet_id: uuid.UUID, body: PalletDateIn, svc: SavingsService = Depends(get_service)):
    return svc.set_pallet_date(pallet_id, body.milling_date)


@router.post("/floor-plan")
def setup_floor(svc: SavingsService = Depends(get_service)):
    return svc.setup_floor()


@router.get("/farmers")
def farmers(svc: SavingsService = Depends(get_service)):
    return svc.farmer_balances()


@router.post("/farmers/pay")
def pay_farmer(body: PaymentIn, svc: SavingsService = Depends(get_service)):
    return svc.pay_farmer(body)


@router.post("/holds", status_code=201)
def place_hold(body: HoldIn, svc: SavingsService = Depends(get_service)):
    return svc.place_hold(body)


@router.post("/holds/{hold_id}/clear")
def clear_hold(hold_id: uuid.UUID, body: ClearIn, svc: SavingsService = Depends(get_service)):
    return svc.clear_hold(hold_id, body.note)


@router.post("/readings", status_code=201)
def add_reading(body: ReadingIn, svc: SavingsService = Depends(get_service)):
    return svc.add_reading(body)


@router.get("/capacity")
def capacity(svc: SavingsService = Depends(get_service)):
    return svc.capacity()


@router.get("/cost-per-sack")
def cost_per_sack(svc: SavingsService = Depends(get_service)):
    return svc.cost_per_sack()


@router.get("/advances")
def advances(svc: SavingsService = Depends(get_service)):
    return svc.advances()


@router.post("/advances", status_code=201)
def create_advance(body: AdvanceIn, svc: SavingsService = Depends(get_service)):
    return svc.create_advance(body)


@router.post("/advances/{advance_id}/void")
def void_advance(advance_id: uuid.UUID, svc: SavingsService = Depends(get_service)):
    return svc.void_advance(advance_id)


@price_router.get("/orders/{order_id}/pick-list")
def pick_list(order_id: uuid.UUID, svc: SavingsService = Depends(get_service)):
    return svc.pick_list(order_id)


@paddy_router.get("/suppliers/{supplier_id}/vale")
def supplier_vale(supplier_id: uuid.UUID, svc: SavingsService = Depends(get_service)):
    return svc.supplier_vale(supplier_id)


@price_router.post("/price-check")
def price_check(body: PriceCheckIn, svc: SavingsService = Depends(get_service)):
    return svc.price_check([i.model_dump() for i in body.items])
