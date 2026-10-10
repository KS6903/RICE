"""Demo data for the Enterprise automations, on the Enterprise test tenant (mill1).

Builds sixty days of believable mill activity ending today, in the mill's own
timezone: palay buying with moisture and price spread, drying, daily milling,
sales with line items, invoices and payments, expenses, deliveries and the
audit trail. A few things are planted on purpose so each recipe has something
true to say:

- wet palay bought this morning with nothing drying it; a batch left running
- one recent batch with poor recovery; one operator milling below the other
- a customer over their credit limit, overdue invoices, one regular gone quiet
- an encoder paying one supplier noticeably more than everyone else pays, and
  below-price-list sales and a big discount clustered on one customer
- an unusually large maintenance bill, late edits and stock adjustments
- one variety running low, a delivery that's late, tomorrow's with no truck

Everything it creates is tagged (numbers start AUTO-, remarks carry MARKER), so
``--reset`` removes the last run before seeding again. Customers, suppliers
and the price list are matched by name and kept.

Refuses any tenant whose plan doesn't include automations: Enterprise only.

Usage (after ``alembic upgrade head`` and ``migrate_all_tenants.py``):
    python seed_demo_automations.py                 # mill1
    python seed_demo_automations.py mill1 --reset   # replace the last run
"""

from __future__ import annotations

import random
import sys
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select

from app.automations.cash import cash_received
from app.automations.engine import entitled
from app.core.database import SessionLocal
from app.core.tenancy import set_search_path
from app.core.timezones import tenant_zone
from app.models.action import ActionItem
from app.models.activity import ActivityLog
from app.models.automation import AutomationRule
from app.models.cash import CashCount
from app.models.collections import CollectionFollowUp
from app.models.company import Branch
from app.models.costs import Expense, ExpenseCategory
from app.models.fleet import DispatchTrip, Driver, Truck
from app.models.maintenance import Equipment
from app.models.milling import (
    ByproductInventory,
    MilledRiceInventory,
    MillingBatch,
    MillingBatchInput,
    MillingBatchOutput,
)
from app.models.paddy import DryingRecord, PalayInventory, PalayPurchase, PalayPurchaseItem
from app.models.reference import RiceVariety
from app.models.sales import Invoice, Payment, PriceList, SalesOrder, SalesOrderItem
from app.models.supplier_customer import Customer, Supplier
from app.models.user import User

MARKER = "demo-automations-seed"
DAYS = 60
KG_PER_CAVAN = Decimal(50)

# name, type, credit limit, payment terms, phone, orders per week (0 = gone quiet)
CUSTOMERS = (
    ("Metro Rice Distributors", "wholesaler", 2_000_000, 15, "0917 555 0142", 2.0),
    ("SuperBigas Trading", "wholesaler", 1_200_000, 30, "0918 555 0177", 1.5),
    ("Aling Nena Sari-Sari", "retailer", 150_000, 7, "0921 555 0103", 1.0),
    ("Bigasan ni Mang Tonyo", "retailer", 600_000, 15, "0927 555 0188", 1.0),
    ("Cabanatuan Public Market Stall 12", "retailer", 100_000, 7, "0935 555 0121", 0.0),
    ("San Jose Grocery", "retailer", 900_000, 15, "0906 555 0164", 1.0),
)
# The customer whose orders the encoder discounts and prices under the list.
FAVOURED_CUSTOMER = "Bigasan ni Mang Tonyo"
# The supplier the encoder pays over the going price.
FAVOURED_SUPPLIER = "Golden Harvest Supply"
VARIETIES = ("Rc222", "Rc216", "SINAG")
BASE_PRICE = {"Rc222": 1180, "Rc216": 1150, "SINAG": 1260}  # ₱/cavan at 14% moisture
RICE_PRICE = {"Rc222": Decimal("52.00"), "Rc216": Decimal("50.00"), "SINAG": Decimal("56.00")}  # ₱/kg list
BYPRODUCT_PRICE = {"darak": Decimal("14.00"), "binlid": Decimal("32.00")}


def _local(day: date, hour: int, minute: int, zone) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=zone).astimezone(timezone.utc)


def _reset(db, cid: uuid.UUID) -> None:
    orders = select(SalesOrder.id).where(SalesOrder.order_no.like("SO-AUTO-%"))
    invoices = select(Invoice.id).where(Invoice.invoice_no.like("INV-AUTO-%"))
    purchases = select(PalayPurchase.id).where(PalayPurchase.reference_no.like("PP-AUTO-%"))
    items = select(PalayPurchaseItem.id).where(PalayPurchaseItem.purchase_id.in_(purchases))
    batches = select(MillingBatch.id).where(MillingBatch.batch_no.like("MB-AUTO-%"))
    for stmt in (
        delete(DispatchTrip).where(DispatchTrip.trip_no.like("TRIP-AUTO-%")),
        delete(Payment).where(Payment.invoice_id.in_(invoices)),
        delete(Invoice).where(Invoice.invoice_no.like("INV-AUTO-%")),
        delete(SalesOrderItem).where(SalesOrderItem.order_id.in_(orders)),
        delete(SalesOrder).where(SalesOrder.order_no.like("SO-AUTO-%")),
        delete(DryingRecord).where(DryingRecord.purchase_item_id.in_(items)),
        delete(PalayPurchaseItem).where(PalayPurchaseItem.purchase_id.in_(purchases)),
        delete(PalayPurchase).where(PalayPurchase.reference_no.like("PP-AUTO-%")),
        delete(MillingBatchOutput).where(MillingBatchOutput.batch_id.in_(batches)),
        delete(MillingBatchInput).where(MillingBatchInput.batch_id.in_(batches)),
        delete(MillingBatch).where(MillingBatch.batch_no.like("MB-AUTO-%")),
        delete(Expense).where(Expense.reference_no.like("EXP-AUTO-%")),
        delete(ActivityLog).where(ActivityLog.detail.like(f"%{MARKER}%")),
        delete(ActionItem).where(ActionItem.source_key.like(f"{MARKER}:task:%")),
        delete(CollectionFollowUp).where(CollectionFollowUp.note.like(f"%[{MARKER}]")),
        delete(CashCount).where(CashCount.note.like(f"%[{MARKER}]")),
        delete(Equipment).where(Equipment.notes.like(f"%[{MARKER}]")),
    ):
        db.execute(stmt)
    db.flush()


def seed(db, username: str, *, reset: bool) -> str:
    owner = db.query(User).filter(User.username == username).first()
    if owner is None or owner.company is None:
        return f"{username}: no such user"
    company = owner.company
    if not entitled(db, company.id):
        return f"{username}: {company.name} isn't on a plan with automations (Enterprise only); refused"
    set_search_path(db, company.schema_name)
    cid = company.id
    zone = tenant_zone(company.timezone)
    today = datetime.now(timezone.utc).astimezone(zone).date()

    existing = db.query(PalayPurchase).filter(PalayPurchase.reference_no.like("PP-AUTO-%")).count()
    if existing and not reset:
        return f"{username}: already seeded ({existing} purchases). Pass --reset to replace it."
    if reset:
        _reset(db, cid)

    rng = random.Random(f"{MARKER}:{username}")
    staff = {u.role.name: u for u in db.query(User).filter(User.company_id == cid) if u.role}
    encoder = staff.get("encoder", owner)
    cashier = staff.get("cashier", owner)
    operator = staff.get("mill_operator", owner)
    branch = db.query(Branch).filter(Branch.company_id == cid, Branch.is_main_branch.is_(True)).first()
    bid = branch.id if branch else None

    varieties = {v.code: v for v in db.query(RiceVariety).filter(RiceVariety.code.in_(VARIETIES))}
    if len(varieties) < len(VARIETIES):
        return f"{username}: the variety catalog is missing one of {VARIETIES}; run seed.py first"

    # ── people the mill deals with ────────────────────────────────────────────
    customers: dict[str, Customer] = {}
    for name, kind, limit, terms, phone, _pace in CUSTOMERS:
        c = db.query(Customer).filter(Customer.name == name).first()
        if c is None:
            c = Customer(company_id=cid, branch_id=bid, name=name, customer_type=kind, is_active=True)
            db.add(c)
        c.credit_limit, c.payment_terms_days, c.phone = Decimal(limit), terms, phone
        customers[name] = c
    suppliers = {s.name: s for s in db.query(Supplier).filter(Supplier.company_id == cid, Supplier.is_active.is_(True))}
    if FAVOURED_SUPPLIER not in suppliers:
        s = Supplier(company_id=cid, branch_id=bid, name=FAVOURED_SUPPLIER, supplier_type="trader", is_active=True)
        db.add(s)
        suppliers[FAVOURED_SUPPLIER] = s
    db.flush()

    # ── price list: one entry per variety, Grade A, in force all period ───────
    for code, per_kg in RICE_PRICE.items():
        v = varieties[code]
        p = db.query(PriceList).filter(PriceList.variety_id == v.id, PriceList.grade_name == "A").first()
        if p is None:
            p = PriceList(company_id=cid, variety_id=v.id, grade_name="A", is_active=True)
            db.add(p)
        p.price_per_kg, p.effective_date, p.expiry_date = per_kg, today - timedelta(days=DAYS + 30), None

    # ── palay buying and drying ───────────────────────────────────────────────
    palay_bought: dict[str, Decimal] = {code: Decimal(0) for code in VARIETIES}
    n = 0
    for back in range(DAYS, -1, -1):
        day = today - timedelta(days=back)
        for _ in range(rng.choice((0, 1, 1, 1, 2))):
            n += 1
            supplier = rng.choice(list(suppliers.values()))
            code = rng.choice(VARIETIES)
            moisture = Decimal(str(round(rng.uniform(13.0, 24.0), 1)))
            # Wetter palay is worth less: about ₱12 a cavan per point over 14%.
            price = BASE_PRICE[code] - max(Decimal(0), moisture - 14) * 12 + rng.randint(-30, 30)
            price += Decimal(back < 14 and 25 or 0)  # prices firming over the last two weeks
            by = encoder if rng.random() < 0.8 else owner
            if supplier.name == FAVOURED_SUPPLIER and by is encoder:
                price *= Decimal("1.07")  # planted: the encoder pays this supplier ~7% over
            cavans = rng.randint(60, 110)
            entered = min(_local(day, rng.randint(7, 15), rng.randint(0, 59), zone), datetime.now(timezone.utc))
            purchase = PalayPurchase(
                company_id=cid,
                branch_id=bid,
                reference_no=f"PP-AUTO-{day:%Y%m%d}-{n:03d}",
                supplier_id=supplier.id,
                purchase_date=day,
                delivery_type="delivered",
                status="completed",
                created_by=by.id,
                created_at=entered,
                updated_at=entered,
            )
            db.add(purchase)
            db.flush()
            gross = Decimal(cavans) * KG_PER_CAVAN + rng.randint(20, 60)
            item = PalayPurchaseItem(
                purchase_id=purchase.id,
                variety_id=varieties[code].id,
                gross_weight_kg=gross,
                tare_weight_kg=Decimal(rng.randint(20, 60)),
                cavan_count=Decimal(cavans),
                moisture_content_pct=moisture,
                price_per_cavan=Decimal(price).quantize(Decimal("0.01")),
            )
            db.add(item)
            db.flush()
            palay_bought[code] += gross - item.tare_weight_kg
            # Wet palay goes to the dryer the same day, except this morning's.
            if moisture > 14 and back > 0:
                start = entered + timedelta(hours=2)
                done = back > 2 or rng.random() < 0.5
                db.add(
                    DryingRecord(
                        purchase_item_id=item.id,
                        start_datetime=start,
                        end_datetime=start + timedelta(hours=rng.randint(20, 40)) if done else None,
                        initial_moisture_pct=moisture,
                        final_moisture_pct=Decimal("13.8") if done else None,
                        drying_method=rng.choice(("sun", "sun", "mechanical")),
                        drying_cost=Decimal(cavans * rng.randint(18, 25)),
                        operator_id=operator.id,
                    )
                )
    # Planted: two wet lots bought early this morning, nobody drying them yet.
    for k, code in enumerate(("Rc222", "SINAG")):
        n += 1
        entered = datetime.now(timezone.utc) - timedelta(hours=14 + k)
        purchase = PalayPurchase(
            company_id=cid,
            branch_id=bid,
            reference_no=f"PP-AUTO-{today:%Y%m%d}-W{k + 1}",
            supplier_id=suppliers["San Isidro Farmers Co-op"].id if "San Isidro Farmers Co-op" in suppliers else None,
            purchase_date=entered.astimezone(zone).date(),
            status="completed",
            created_by=encoder.id,
            created_at=entered,
            updated_at=entered,
        )
        db.add(purchase)
        db.flush()
        db.add(
            PalayPurchaseItem(
                purchase_id=purchase.id,
                variety_id=varieties[code].id,
                gross_weight_kg=Decimal(6040),
                tare_weight_kg=Decimal(40),
                cavan_count=Decimal(120),
                moisture_content_pct=Decimal("23.5") if k == 0 else Decimal("21.0"),
                price_per_cavan=Decimal(BASE_PRICE[code] - 110),
            )
        )

    # ── milling: most days, the operator and the owner taking turns ──────────
    milled: dict[str, Decimal] = {code: Decimal(0) for code in VARIETIES}
    palay_used: dict[str, Decimal] = {code: Decimal(0) for code in VARIETIES}
    for back in range(DAYS, 0, -1):
        day = today - timedelta(days=back)
        if day.weekday() == 6:  # Sundays off
            continue
        code = rng.choice(VARIETIES)
        typical = Decimal(varieties[code].typical_recovery_pct or 64)
        by = operator if back % 2 else owner
        # Planted: the operator's batches run ~4 points under; yesterday's is worse.
        recovery = typical + Decimal(str(round(rng.uniform(-1.5, 1.0), 1))) - (4 if by is operator else 0)
        if back == 1:
            recovery = typical - 9
        input_kg = Decimal(rng.randint(60, 120) * 50)
        start = _local(day, 7, 30, zone)
        batch = MillingBatch(
            company_id=cid,
            branch_id=bid,
            batch_no=f"MB-AUTO-{day:%Y%m%d}",
            operator_id=by.id,
            start_datetime=start,
            end_datetime=start + timedelta(hours=8),
            status="completed",
            created_by=by.id,
            created_at=start,
            updated_at=start + timedelta(hours=8),
        )
        db.add(batch)
        db.flush()
        rice_kg = (input_kg * recovery / 100).quantize(Decimal(1))
        broken = Decimal(str(round(rng.uniform(6, 12), 1))) + (Decimal(9) if back == 1 else 0)
        db.add(MillingBatchInput(batch_id=batch.id, variety_id=varieties[code].id, input_weight_kg=input_kg))
        db.add_all(
            [
                MillingBatchOutput(
                    batch_id=batch.id,
                    output_type="milled_rice",
                    variety_id=varieties[code].id,
                    output_weight_kg=rice_kg,
                    broken_rice_pct=broken,
                    milling_recovery_pct=recovery,
                ),
                MillingBatchOutput(
                    batch_id=batch.id,
                    output_type="darak",
                    output_weight_kg=(input_kg * Decimal("0.09")).quantize(Decimal(1)),
                ),
                MillingBatchOutput(
                    batch_id=batch.id,
                    output_type="ipa",
                    output_weight_kg=(input_kg * Decimal("0.20")).quantize(Decimal(1)),
                ),
            ]
        )
        milled[code] += rice_kg
        palay_used[code] += input_kg
    # Planted: today's batch started yesterday afternoon and was never closed.
    open_start = datetime.now(timezone.utc) - timedelta(hours=30)
    db.add(
        MillingBatch(
            company_id=cid,
            branch_id=bid,
            batch_no=f"MB-AUTO-{today:%Y%m%d}-OPEN",
            operator_id=operator.id,
            start_datetime=open_start,
            status="in_progress",
            created_by=operator.id,
            created_at=open_start,
            updated_at=open_start,
        )
    )

    # ── selling: line items, invoices on terms, payments ─────────────────────
    sold: dict[str, Decimal] = {code: Decimal(0) for code in VARIETIES}
    order_n = 0
    orders_to_edit: list[SalesOrder] = []
    for name, _kind, _limit, terms, _phone, pace in CUSTOMERS:
        customer = customers[name]
        days = range(DAYS, -1, -1)
        if pace == 0:  # used to buy weekly, stopped six weeks ago
            pace, days = 1.0, range(DAYS, 42, -1)
        for back in days:
            if rng.random() > pace / 6:
                continue
            day = today - timedelta(days=back)
            order_n += 1
            by = encoder if rng.random() < 0.6 else cashier
            code = rng.choice(VARIETIES)
            sizes = (
                (2000, 3000, 4000, 5000, 6000)
                if customer.customer_type == "wholesaler"
                else (250, 500, 750, 1000, 1500)
            )
            qty = Decimal(rng.choice(sizes))
            unit = RICE_PRICE[code] + Decimal(rng.choice((0, 0, 0.5, 1)))
            discount_pct = Decimal(0)
            if name == FAVOURED_CUSTOMER and by is encoder:
                unit = RICE_PRICE[code] - Decimal(rng.choice((3, 4, 5)))  # planted: under the list
                discount_pct = Decimal(rng.choice((0, 0, 8)))  # planted: and the odd big discount
            lines = [("milled_rice", code, qty, unit)]
            if rng.random() < 0.3:
                lines.append(("byproduct", "darak", Decimal(rng.choice((200, 400))), BYPRODUCT_PRICE["darak"]))
            subtotal = sum(q * u for _, _, q, u in lines)
            discount = (subtotal * discount_pct / 100).quantize(Decimal("0.01"))
            total = subtotal - discount
            entered = min(_local(day, rng.randint(8, 16), rng.randint(0, 59), zone), datetime.now(timezone.utc))
            delivery = day + timedelta(days=rng.choice((0, 1, 2)))
            delivered = delivery < today - timedelta(days=1) or (delivery < today and rng.random() < 0.7)
            order = SalesOrder(
                company_id=cid,
                branch_id=bid,
                order_no=f"SO-AUTO-{day:%Y%m%d}-{order_n:03d}",
                customer_id=customer.id,
                order_date=day,
                delivery_date=delivery,
                status="confirmed",
                discount_pct=discount_pct,
                discount_amount=discount,
                subtotal=subtotal,
                total_amount=total,
                remarks=MARKER,
                created_by=by.id,
                delivered_at=_local(delivery, 15, 0, zone) if delivered else None,
                created_at=entered,
                updated_at=entered,
            )
            db.add(order)
            db.flush()
            for kind, what, q, u in lines:
                db.add(
                    SalesOrderItem(
                        order_id=order.id,
                        item_type=kind,
                        variety_id=varieties[what].id if kind == "milled_rice" else None,
                        grade_name="A" if kind == "milled_rice" else None,
                        byproduct_type=what if kind == "byproduct" else None,
                        quantity_kg=q,
                        unit_price_per_kg=u,
                    )
                )
            sold[code] += qty
            if back > 25 and by is encoder and len(orders_to_edit) < 3:
                orders_to_edit.append(order)
            # Invoice on delivery; most are paid on time, some late, some not yet.
            if back < 1:
                continue
            due = day + timedelta(days=terms)
            invoice = Invoice(
                company_id=cid,
                branch_id=bid,
                invoice_no=f"INV-AUTO-{day:%Y%m%d}-{order_n:03d}",
                order_id=order.id,
                customer_id=customer.id,
                invoice_date=day,
                due_date=due,
                total_amount=total,
                paid_amount=Decimal(0),
                status="unpaid",
                created_by=by.id,
                created_at=entered,
                updated_at=entered,
            )
            db.add(invoice)
            db.flush()
            order.status = "invoiced"
            late_payer = name in ("Aling Nena Sari-Sari", "Metro Rice Distributors")
            paid_day = due + timedelta(days=rng.randint(-5, 2) + (rng.randint(10, 30) if late_payer else 0))
            if paid_day < today:
                share = Decimal(1) if rng.random() < 0.85 or not late_payer else Decimal("0.5")
                amount = (total * share).quantize(Decimal("0.01"))
                db.add(
                    Payment(
                        invoice_id=invoice.id,
                        payment_date=paid_day,
                        amount=amount,
                        method=rng.choice(("cash", "cash", "gcash", "bank_transfer", "check")),
                        received_by=cashier.id,
                        created_at=_local(paid_day, 14, 0, zone),
                    )
                )
                invoice.paid_amount = amount
                invoice.status = "paid" if share == 1 else "partial"
                if share == 1:
                    order.status = "paid"
            if invoice.status in ("unpaid", "partial") and due < today:
                invoice.status = "overdue"
    # Today's cash so the cash-up has something to count.
    for k, (amount, method) in enumerate(
        ((Decimal(18_500), "cash"), (Decimal(42_000), "gcash"), (Decimal(9_750), "cash"))
    ):
        open_invoice = (
            db.query(Invoice).filter(Invoice.invoice_no.like("INV-AUTO-%"), Invoice.status == "unpaid").first()
        )
        if open_invoice is None:
            break
        db.add(
            Payment(
                invoice_id=open_invoice.id,
                payment_date=today,
                amount=min(amount, open_invoice.total_amount),
                method=method,
                received_by=cashier.id if k != 1 else owner.id,
                created_at=datetime.now(timezone.utc),
            )
        )
        open_invoice.paid_amount = min(amount, open_invoice.total_amount)
        open_invoice.status = "paid" if open_invoice.paid_amount >= open_invoice.total_amount else "partial"
    # Planted: tomorrow's delivery for Metro Rice with no trip, and a late one.
    for back, delivery in ((0, today + timedelta(days=1)), (4, today - timedelta(days=2))):
        order_n += 1
        day = today - timedelta(days=back)
        code = "Rc222"
        qty = Decimal(3000)
        total = qty * RICE_PRICE[code]
        db.add(
            SalesOrder(
                company_id=cid,
                branch_id=bid,
                order_no=f"SO-AUTO-{day:%Y%m%d}-{order_n:03d}",
                customer_id=customers["Metro Rice Distributors"].id,
                order_date=day,
                delivery_date=delivery,
                status="confirmed",
                discount_pct=Decimal(0),
                discount_amount=Decimal(0),
                subtotal=total,
                total_amount=total,
                remarks=MARKER,
                created_by=cashier.id,
                created_at=_local(day, 10, 0, zone),
                updated_at=_local(day, 10, 0, zone),
            )
        )
    # Planted for the owner-watch alerts, entered this morning: palay bought
    # well over the going price, a discounted sale under the price list, and a
    # cancelled order.
    this_morning = datetime.now(timezone.utc) - timedelta(hours=2)
    n += 1
    dear = PalayPurchase(
        company_id=cid,
        branch_id=bid,
        reference_no=f"PP-AUTO-{today:%Y%m%d}-D1",
        supplier_id=suppliers[FAVOURED_SUPPLIER].id,
        purchase_date=today,
        status="completed",
        created_by=encoder.id,
        created_at=this_morning,
        updated_at=this_morning,
    )
    db.add(dear)
    db.flush()
    db.add(
        PalayPurchaseItem(
            purchase_id=dear.id,
            variety_id=varieties["Rc222"].id,
            gross_weight_kg=Decimal(4040),
            tare_weight_kg=Decimal(40),
            cavan_count=Decimal(80),
            moisture_content_pct=Decimal("18.5"),
            price_per_cavan=Decimal(BASE_PRICE["Rc222"] + 180),
        )
    )
    for k, status in enumerate(("confirmed", "cancelled")):
        order_n += 1
        unit = RICE_PRICE["Rc222"] - 4
        qty = Decimal(2000)
        subtotal = qty * unit
        discount = (subtotal * Decimal("0.08")).quantize(Decimal("0.01")) if k == 0 else Decimal(0)
        order = SalesOrder(
            company_id=cid,
            branch_id=bid,
            order_no=f"SO-AUTO-{today:%Y%m%d}-{order_n:03d}",
            customer_id=customers[FAVOURED_CUSTOMER].id,
            order_date=today,
            delivery_date=today + timedelta(days=2),
            status=status,
            discount_pct=Decimal(8) if k == 0 else Decimal(0),
            discount_amount=discount,
            subtotal=subtotal,
            total_amount=subtotal - discount,
            remarks=MARKER,
            created_by=encoder.id,
            created_at=this_morning + timedelta(minutes=20 * k),
            updated_at=this_morning + timedelta(minutes=20 * k + 30),
        )
        db.add(order)
        db.flush()
        db.add(
            SalesOrderItem(
                order_id=order.id,
                item_type="milled_rice",
                variety_id=varieties["Rc222"].id,
                grade_name="A",
                quantity_kg=qty,
                unit_price_per_kg=unit,
            )
        )
    # Trips for the rest of the recent undelivered orders, so only one is truckless.
    truck = db.query(Truck).filter(Truck.is_active.is_(True)).first()
    driver = db.query(Driver).filter(Driver.is_active.is_(True)).first()
    if truck and driver:
        for k, o in enumerate(
            db.query(SalesOrder).filter(
                SalesOrder.order_no.like("SO-AUTO-%"),
                SalesOrder.delivered_at.is_(None),
                SalesOrder.delivery_date >= today,
                SalesOrder.customer_id != customers["Metro Rice Distributors"].id,
            )
        ):
            db.add(
                DispatchTrip(
                    company_id=cid,
                    branch_id=bid,
                    trip_no=f"TRIP-AUTO-{today:%Y%m%d}-{k + 1:02d}",
                    truck_id=truck.id,
                    driver_id=driver.id,
                    order_id=o.id,
                    dispatch_date=o.delivery_date,
                    destination=o.customer.name if o.customer else None,
                    status="planned",
                    created_by=owner.id,
                )
            )

    # ── stock on hand, consistent with the above, with one variety running low
    for code in VARIETIES:
        v = varieties[code]
        rice_left = Decimal(4000) + milled[code] - sold[code]
        if rice_left < sold[code] / DAYS * 8:  # keep a believable week or two of cover
            rice_left = (sold[code] / DAYS * 12).quantize(Decimal(1))
        if code == "Rc216":
            rice_left = Decimal(600)  # planted: about a day or two of sales left
        row = (
            db.query(MilledRiceInventory)
            .filter(MilledRiceInventory.variety_id == v.id, MilledRiceInventory.grade_name == "A")
            .first()
        )
        if row is None:
            row = MilledRiceInventory(company_id=cid, branch_id=bid, variety_id=v.id, grade_name="A")
            db.add(row)
        row.quantity_kg = rice_left
        palay_left = max(Decimal(2000), palay_bought[code] - palay_used[code])
        prow = db.query(PalayInventory).filter(PalayInventory.variety_id == v.id).first()
        if prow is None:
            prow = PalayInventory(company_id=cid, branch_id=bid, variety_id=v.id)
            db.add(prow)
        prow.quantity_kg = palay_left
    bran = db.query(ByproductInventory).filter(ByproductInventory.byproduct_type == "darak").first()
    if bran is None:
        bran = ByproductInventory(company_id=cid, branch_id=bid, byproduct_type="darak")
        db.add(bran)
    bran.quantity_kg = Decimal(-180)  # planted: more bran sold than was recorded milled

    # ── expenses, with one bill far above its usual ───────────────────────────
    categories = {c.name: c for c in db.query(ExpenseCategory).filter(ExpenseCategory.company_id == cid)}
    regular = (("Fuel", 4_500, 2), ("Electricity", 9_000, 7), ("Labor", 18_000, 7), ("Maintenance", 2_500, 5))
    e = 0
    for back in range(DAYS, 0, -1):
        day = today - timedelta(days=back)
        for cat, usual, every in regular:
            if back % every or cat not in categories:
                continue
            e += 1
            at = _local(day, 17, 0, zone)
            db.add(
                Expense(
                    company_id=cid,
                    branch_id=bid,
                    category_id=categories[cat].id,
                    expense_date=day,
                    amount=Decimal(usual + rng.randint(-400, 400)),
                    description=f"{cat} ({MARKER})",
                    reference_no=f"EXP-AUTO-{e:04d}",
                    created_by=owner.id,
                    created_at=at,
                    updated_at=at,
                )
            )
    if "Maintenance" in categories:
        at = datetime.now(timezone.utc) - timedelta(hours=3)
        db.add(
            Expense(
                company_id=cid,
                branch_id=bid,
                category_id=categories["Maintenance"].id,
                expense_date=today,
                amount=Decimal(38_500),
                description="Huller rubber rolls and labor",
                reference_no="EXP-AUTO-BIG",
                created_by=encoder.id,
                created_at=at,
                updated_at=at,
            )
        )

    # ── the audit trail: late edits and stock adjustments by the encoder ──────
    for k, order in enumerate(orders_to_edit):
        db.add(
            ActivityLog(
                company_id=cid,
                user_id=encoder.id,
                action="api.put",
                entity_type="sales",
                entity_label=f"/api/sales/orders/{order.id}",
                detail=f"status=200; request_id={MARKER}-edit-{k}",
                created_at=datetime.now(timezone.utc) - timedelta(hours=2 + 30 * k),
            )
        )
    for k in range(4):
        db.add(
            ActivityLog(
                company_id=cid,
                user_id=encoder.id,
                action="api.post",
                entity_type="inventory",
                entity_label="/api/inventory/adjust",
                detail=f"status=200; request_id={MARKER}-adjust-{k}",
                created_at=datetime.now(timezone.utc) - timedelta(days=3 * k + 1),
            )
        )

    # ── switch the rule-based recipes on, in-app only (no email to testers) ───
    from app.automations.recipes import RECIPES

    switched = 0
    for code, recipe in RECIPES.items():
        if recipe.uses_ai:
            continue  # AI needs the owner's own consent, on the Automations page
        rule = db.query(AutomationRule).filter(AutomationRule.recipe == code).first()
        if rule is None:
            rule = AutomationRule(company_id=cid, recipe=code, recipients=[])
            db.add(rule)
        rule.enabled = True
        rule.params = {**recipe.params().model_dump(), **(rule.params or {}), "email": False}
        switched += 1

    # ── follow-through: two automations tracked as tasks, and a few tasks ────
    accountant = staff.get("accountant", owner)
    for code, person, hours in (("due_reminders", accountant, 24), ("wet_palay", operator, 6)):
        rule = db.query(AutomationRule).filter(AutomationRule.recipe == code).first()
        if rule is not None:
            rule.track, rule.track_assignee, rule.track_due_hours = True, person.id, hours
    now = datetime.now(timezone.utc)
    demo_tasks = (
        ("wet_palay", "Wet palay not drying: PP-AUTO-DEMO", operator, now - timedelta(hours=3), "open"),
        (
            "due_reminders",
            "Collections: call Aling Nena Store about 2 overdue invoices",
            accountant,
            now + timedelta(hours=20),
            "acknowledged",
        ),
        ("negative_stock", "Stock below zero: Rc216 milled rice", None, now + timedelta(hours=4), "open"),
    )
    for source, title, person, due_at, state in demo_tasks:
        key = f"{MARKER}:task:{source}"
        if db.query(ActionItem).filter(ActionItem.source_key == key).first() is None:
            db.add(
                ActionItem(
                    company_id=cid,
                    source=source,
                    source_key=key,
                    title=title,
                    body="Demo task: seeded so the To do page has something to show.",
                    link="/automations",
                    assignee_id=person.id if person else None,
                    due_at=due_at,
                    status=state,
                    acknowledged_at=now if state == "acknowledged" else None,
                )
            )

    # ── cash counts: a week of them, one short and not yet reviewed ──────────
    cashier_user = staff.get("cashier", owner)
    drawer = Decimal(5_000)
    for back in range(7, 0, -1):
        on = today - timedelta(days=back)
        if db.query(CashCount).filter(CashCount.count_date == on).first() is not None:
            continue
        received = sum((amount for _, amount in cash_received(db, on)), Decimal(0))
        paid_out = Decimal(rng.choice((0, 500, 1_200, 2_000)))
        short = Decimal(650) if back == 2 else Decimal(0)
        counted = drawer + received - paid_out - short
        db.add(
            CashCount(
                company_id=cid,
                count_date=on,
                opening=drawer,
                cash_in=received,
                cash_out=paid_out,
                counted=counted,
                taken_out=max(Decimal(0), counted - Decimal(5_000)),
                note=f"Demo count [{MARKER}]",
                counted_by=cashier_user.id,
            )
        )
        drawer = min(counted, Decimal(5_000))

    # ── maintenance: a huller close to its service, a polisher fine ─────────
    machines = (
        Equipment(
            name="Rubber-roll huller",
            every_hours=120,
            every_tonnes=Decimal(400),
            last_service_on=today - timedelta(days=20),
            notes="Replace the rubber rolls.",
        ),
        Equipment(
            name="Polisher",
            every_days=90,
            last_service_on=today - timedelta(days=30),
            notes="Check the screens and the bran blower.",
        ),
    )
    for machine in machines:
        if db.query(Equipment).filter(Equipment.name == machine.name).first() is None:
            machine.company_id, machine.notes = cid, f"{machine.notes} [{MARKER}]"
            db.add(machine)

    # ── collections: a promise not kept, and one still to come ───────────────
    from app.automations.collections import worklist

    owing = [d for d in worklist(db, today) if d.overdue > 0][:2]
    for d, promised_on, said in zip(
        owing,
        (today - timedelta(days=2), today + timedelta(days=3)),
        ("Said they'd pay after their harvest sale.", "Paying when their buyer settles."),
        strict=False,
    ):
        note = f"{said} [{MARKER}]"
        if db.query(CollectionFollowUp).filter(CollectionFollowUp.note == note).first() is None:
            db.add(
                CollectionFollowUp(
                    company_id=cid,
                    customer_id=d.customer.id,
                    outcome="promised",
                    promised_date=promised_on,
                    note=note,
                    created_by=accountant.id,
                    created_at=datetime.now(timezone.utc) - timedelta(days=5),
                )
            )

    db.commit()
    return (
        f"{username}: {n} palay purchases, {order_n} sales orders, {e + 1} expenses over {DAYS} days to {today}; "
        f"{switched} rule-based automations switched on (bell only)"
    )


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    reset = "--reset" in sys.argv
    db = SessionLocal()
    try:
        for username in args or ["mill1"]:
            print(seed(db, username, reset=reset))
    finally:
        db.close()


if __name__ == "__main__":
    main()
