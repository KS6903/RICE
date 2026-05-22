import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user, require_feature
from ..models.sales import SalesOrder, SalesOrderItem, Invoice, Payment, PriceList
from ..models.supplier_customer import Customer

router = APIRouter(dependencies=[Depends(require_feature("sales"))])


# ── Customers ─────────────────────────────────────────────────────────────────

class CustomerCreate(BaseModel):
    customer_type: str | None = None
    name: str
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    tin: str | None = None
    credit_limit: Decimal = Decimal("0")
    payment_terms_days: int = 0
    is_p20_accredited: bool = False


class CustomerUpdate(BaseModel):
    customer_type: str | None = None
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    tin: str | None = None
    credit_limit: Decimal | None = None
    payment_terms_days: int | None = None
    is_p20_accredited: bool | None = None
    is_active: bool | None = None


@router.get("/customers")
def list_customers(
    include_inactive: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Customer).filter(Customer.company_id == current_user.company_id)
    if not include_inactive:
        q = q.filter(Customer.is_active == True)
    return q.order_by(Customer.name).all()


@router.post("/customers", status_code=status.HTTP_201_CREATED)
def create_customer(body: CustomerCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    customer = Customer(company_id=current_user.company_id, branch_id=current_user.branch_id, **body.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.put("/customers/{customer_id}")
def update_customer(customer_id: uuid.UUID, body: CustomerUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Customer, customer_id)
    if not c or c.company_id != current_user.company_id:
        raise HTTPException(404, "Customer not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(c, field, val)
    db.commit()
    db.refresh(c)
    return c


# ── Price List ────────────────────────────────────────────────────────────────

@router.get("/prices")
def list_prices(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(PriceList).filter(PriceList.company_id == current_user.company_id, PriceList.is_active == True).all()


# ── Orders ────────────────────────────────────────────────────────────────────

class OrderItemIn(BaseModel):
    item_type: str  # milled_rice, byproduct
    variety_id: uuid.UUID | None = None
    grade_name: str | None = None
    byproduct_type: str | None = None
    quantity_kg: Decimal
    unit_price_per_kg: Decimal


class OrderCreate(BaseModel):
    customer_id: uuid.UUID
    order_date: date
    delivery_date: date | None = None
    is_p20_sale: bool = False
    discount_pct: Decimal = Decimal("0")
    remarks: str | None = None
    items: list[OrderItemIn]


@router.get("/orders")
def list_orders(skip: int = 0, limit: int = 50, status_filter: str | None = Query(None, alias="status"), current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(SalesOrder).filter(SalesOrder.company_id == current_user.company_id)
    if status_filter:
        q = q.filter(SalesOrder.status == status_filter)
    return q.order_by(SalesOrder.order_date.desc()).offset(skip).limit(limit).all()


@router.post("/orders", status_code=status.HTTP_201_CREATED)
def create_order(body: OrderCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    count = db.query(SalesOrder).count() + 1
    order_no = f"SO-{today}-{count:04d}"

    subtotal = sum(i.quantity_kg * i.unit_price_per_kg for i in body.items)
    discount = subtotal * (body.discount_pct / 100)
    total = subtotal - discount

    order = SalesOrder(
        company_id=current_user.company_id,
        branch_id=current_user.branch_id,
        order_no=order_no,
        customer_id=body.customer_id,
        order_date=body.order_date,
        delivery_date=body.delivery_date,
        is_p20_sale=body.is_p20_sale,
        discount_pct=body.discount_pct,
        discount_amount=discount,
        subtotal=subtotal,
        total_amount=total,
        remarks=body.remarks,
        status="confirmed",
        created_by=current_user.id,
    )
    db.add(order)
    db.flush()

    for item in body.items:
        db.add(SalesOrderItem(order_id=order.id, **item.model_dump()))

    db.commit()
    db.refresh(order)
    return order


@router.put("/orders/{order_id}")
def update_order(order_id: uuid.UUID, body: dict, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    order = db.get(SalesOrder, order_id)
    if not order or order.company_id != current_user.company_id:
        raise HTTPException(404, "Order not found")
    for f in ("status", "delivery_date", "remarks"):
        if f in body:
            setattr(order, f, body[f])
    db.commit()
    return order


# ── Invoices ──────────────────────────────────────────────────────────────────

class InvoiceCreate(BaseModel):
    order_id: uuid.UUID
    invoice_date: date
    due_date: date | None = None


@router.get("/invoices")
def list_invoices(status_filter: str | None = Query(None, alias="status"), current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Invoice).filter(Invoice.company_id == current_user.company_id)
    if status_filter:
        q = q.filter(Invoice.status == status_filter)
    return q.order_by(Invoice.invoice_date.desc()).all()


@router.post("/invoices", status_code=status.HTTP_201_CREATED)
def create_invoice(body: InvoiceCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    order = db.get(SalesOrder, body.order_id)
    if not order or order.company_id != current_user.company_id:
        raise HTTPException(404, "Order not found")
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    count = db.query(Invoice).count() + 1
    inv = Invoice(
        company_id=current_user.company_id,
        branch_id=current_user.branch_id,
        invoice_no=f"INV-{today}-{count:04d}",
        order_id=order.id,
        customer_id=order.customer_id,
        invoice_date=body.invoice_date,
        due_date=body.due_date,
        total_amount=order.total_amount,
        status="unpaid",
        created_by=current_user.id,
    )
    order.status = "invoiced"
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


# ── Payments ──────────────────────────────────────────────────────────────────

class PaymentCreate(BaseModel):
    invoice_id: uuid.UUID
    payment_date: date
    amount: Decimal
    method: str
    reference_no: str | None = None
    notes: str | None = None


@router.post("/payments", status_code=status.HTTP_201_CREATED)
def record_payment(body: PaymentCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.get(Invoice, body.invoice_id)
    if not invoice or invoice.company_id != current_user.company_id:
        raise HTTPException(404, "Invoice not found")
    payment = Payment(
        received_by=current_user.id,
        created_at=datetime.now(timezone.utc),
        **body.model_dump()
    )
    db.add(payment)
    invoice.paid_amount += body.amount
    if invoice.paid_amount >= invoice.total_amount:
        invoice.status = "paid"
        if invoice.order:
            invoice.order.status = "paid"
    elif invoice.paid_amount > 0:
        invoice.status = "partial"
    db.commit()
    db.refresh(payment)
    return payment
