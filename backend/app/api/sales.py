"""Sales domain HTTP controllers — thin routing over SalesService (Phase 3)."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..repositories.sales import (
    CustomerRepository,
    InvoiceRepository,
    PriceListRepository,
    SalesOrderRepository,
)
from ..schemas.sales import (
    CustomerCreate,
    CustomerUpdate,
    InvoiceCreate,
    InvoiceEdit,
    OrderCreate,
    OrderEdit,
    OrderUpdate,
    PaymentCreate,
)
from ..services.activity_service import ActivityService
from ..services.record_changes import require_record_editor
from ..services.sales_service import SalesService

router = APIRouter(
    dependencies=[
        Depends(require_feature("sales")),
        Depends(require_section_access("sales")),
    ]
)


def get_sales_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> SalesService:
    return SalesService(
        db,
        current_user,
        customers=CustomerRepository(db),
        prices=PriceListRepository(db),
        orders=SalesOrderRepository(db),
        invoices=InvoiceRepository(db),
    )


# ── Customers ─────────────────────────────────────────────────────────────────


@router.get("/customers")
def list_customers(include_inactive: bool = False, svc: SalesService = Depends(get_sales_service)):
    return svc.list_customers(include_inactive=include_inactive)


@router.post(
    "/customers",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("sales", write=True))],
)
def create_customer(body: CustomerCreate, svc: SalesService = Depends(get_sales_service)):
    return svc.create_customer(body)


@router.put(
    "/customers/{customer_id}",
    dependencies=[Depends(require_section_access("sales", write=True))],
)
def update_customer(customer_id: uuid.UUID, body: CustomerUpdate, svc: SalesService = Depends(get_sales_service)):
    return svc.update_customer(customer_id, body)


# ── Price List ────────────────────────────────────────────────────────────────


@router.get("/prices")
def list_prices(svc: SalesService = Depends(get_sales_service)):
    return svc.list_prices()


# ── Orders ────────────────────────────────────────────────────────────────────


@router.get("/orders")
def list_orders(
    skip: int = 0,
    limit: int = 50,
    status_filter: str | None = Query(None, alias="status"),
    item_type: str | None = Query(None),
    svc: SalesService = Depends(get_sales_service),
):
    orders = svc.list_orders(skip=skip, limit=limit, status=status_filter, item_type=item_type)
    return [svc.serialize_order(o) for o in orders]


@router.post(
    "/orders",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("sales", write=True))],
)
def create_order(body: OrderCreate, svc: SalesService = Depends(get_sales_service)):
    return svc.create_order(body)


@router.put(
    "/orders/{order_id}",
    dependencies=[Depends(require_section_access("sales", write=True))],
)
def update_order(order_id: uuid.UUID, body: OrderUpdate, svc: SalesService = Depends(get_sales_service)):
    return svc.update_order(order_id, body)


@router.patch("/orders/{order_id}", dependencies=[Depends(require_record_editor)])
def edit_order(order_id: uuid.UUID, body: OrderEdit, svc: SalesService = Depends(get_sales_service)):
    """The Boss corrects a saved order; every changed field is logged."""
    return SalesService.serialize_order(svc.edit_order(order_id, body))


# ── Invoices ──────────────────────────────────────────────────────────────────


@router.get("/invoices")
def list_invoices(
    status_filter: str | None = Query(None, alias="status"),
    svc: SalesService = Depends(get_sales_service),
):
    return svc.list_invoices(status=status_filter)


@router.post(
    "/invoices",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("sales", write=True))],
)
def create_invoice(body: InvoiceCreate, svc: SalesService = Depends(get_sales_service)):
    return svc.create_invoice(body)


@router.patch("/invoices/{invoice_id}", dependencies=[Depends(require_record_editor)])
def edit_invoice(invoice_id: uuid.UUID, body: InvoiceEdit, svc: SalesService = Depends(get_sales_service)):
    """The Boss corrects a saved invoice's dates; every changed field is logged."""
    return svc.edit_invoice(invoice_id, body)


# ── History ───────────────────────────────────────────────────────────────────


@router.get("/history/{entity_type}/{entity_id}")
def record_history(
    entity_type: Literal["sales_order", "invoice", "customer"],
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Every logged change to one order, invoice or customer, newest first."""
    return ActivityService(db, current_user).list_for_entity(current_user.company_id, entity_type, entity_id)


# ── Payments ──────────────────────────────────────────────────────────────────


@router.post(
    "/payments",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("sales", write=True))],
)
def record_payment(body: PaymentCreate, svc: SalesService = Depends(get_sales_service)):
    return svc.record_payment(body)
