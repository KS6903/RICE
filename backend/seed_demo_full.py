"""Seed broad demo data so every module/tab has something to show.

Writes to each tenant's own schema (shared database) via session_for_company.
Idempotent per module — each block skips if it already has rows, so re-running
is safe.

Covers: suppliers, customers, employees, milling equipment, expense categories,
palay purchases (+items), milling batches (+inputs/outputs), and warehouse pallets.
Inventory / sales / expenses are seeded by the other seed_demo_* scripts.

Usage:
    python seed_demo_full.py              # seeds mill1
    python seed_demo_full.py mill1 mill2  # seeds the given users' companies
    python seed_demo_full.py --all        # seeds mill1..mill8
"""

import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from random import choice, uniform

from app.core.database import SessionLocal
from app.core.tenancy import seed_default_expense_categories, session_for_company
from app.models.company import Branch
from app.models.costs import ExpenseCategory
from app.models.dispatch import Agent, Miller
from app.models.employee import Employee
from app.models.fleet import DispatchTrip, Driver, Truck
from app.models.milling import (
    MillingBatch,
    MillingBatchInput,
    MillingBatchOutput,
    MillingEquipment,
)
from app.models.paddy import PalayPurchase, PalayPurchaseItem
from app.models.reference import QualityGrade, RiceVariety
from app.models.supplier_customer import Customer, Supplier
from app.models.user import User
from app.models.warehouse import Pallet, RiceBatch, WarehouseZone
from app.repositories.canva import WarehouseLayoutRepository
from app.services.canva_bootstrap import _next_pallet_code
from app.services.rice_shelf_life import aging_status, compute_best_before
from app.services.warehouses import default_warehouse_id


def _seed_suppliers(db, company_id, branch_id):
    if db.query(Supplier).count():
        return "suppliers: skip"
    rows = [
        ("farmer", "Juan dela Cruz", "Juan dela Cruz", "0917-100-2001", "Nueva Ecija"),
        ("farmer", "Maria Santos", "Maria Santos", "0917-100-2002", "Nueva Ecija"),
        ("trader", "Reyes Grains Trading", "Pedro Reyes", "0917-100-2003", "Tarlac"),
        ("cooperative", "San Isidro Farmers Co-op", "Ana Lim", "0917-100-2004", "Pampanga"),
        ("trader", "Golden Harvest Supply", "Ben Tan", "0917-100-2005", "Bulacan"),
    ]
    for stype, name, contact, phone, prov in rows:
        db.add(
            Supplier(
                company_id=company_id,
                branch_id=branch_id,
                supplier_type=stype,
                name=name,
                contact_person=contact,
                phone=phone,
                province=prov,
                is_active=True,
            )
        )
    return f"suppliers: +{len(rows)}"


def _seed_customers(db, company_id, branch_id):
    if db.query(Customer).count():
        return "customers: skip"
    rows = [
        ("wholesaler", "Metro Rice Distributors", "Carlos Uy", "0918-200-3001", 50000),
        ("retailer", "Aling Nena Sari-Sari", "Nena Cruz", "0918-200-3002", 5000),
        ("government", "NFA - Provincial Office", "NFA Officer", "0918-200-3003", 0),
        ("wholesaler", "SuperBigas Trading", "Liza Co", "0918-200-3004", 80000),
        ("walk_in", "Walk-in Customer", None, None, 0),
    ]
    for ctype, name, contact, phone, credit in rows:
        db.add(
            Customer(
                company_id=company_id,
                branch_id=branch_id,
                customer_type=ctype,
                name=name,
                contact_person=contact,
                phone=phone,
                credit_limit=Decimal(str(credit)),
                payment_terms_days=15 if credit else 0,
                is_active=True,
            )
        )
    return f"customers: +{len(rows)}"


def _seed_employees(db, company_id, branch_id):
    if db.query(Employee).count():
        return "employees: skip"
    rows = [
        ("EMP-001", "Roberto", "Aquino", "Mill Operator", "Operations", "regular", 650),
        ("EMP-002", "Marites", "Bautista", "Cashier", "Office", "regular", 600),
        ("EMP-003", "Ernesto", "Castro", "Driver", "Logistics", "regular", 700),
        ("EMP-004", "Lourdes", "Domingo", "Encoder", "Office", "contractual", 550),
        ("EMP-005", "Pablo", "Enriquez", "Laborer", "Operations", "casual", 500),
        ("EMP-006", "Susan", "Fernandez", "Drying Operator", "Drying", "regular", 600),
    ]
    for no, fn, ln, pos, dept, etype, rate in rows:
        db.add(
            Employee(
                company_id=company_id,
                branch_id=branch_id,
                employee_no=no,
                first_name=fn,
                last_name=ln,
                position=pos,
                department=dept,
                employment_type=etype,
                daily_rate=Decimal(str(rate)),
                date_hired=date(2024, 1, 15),
                is_active=True,
            )
        )
    return f"employees: +{len(rows)}"


def _seed_equipment(db, company_id, branch_id):
    if db.query(MillingEquipment).count():
        return "equipment: skip"
    rows = [("Mill Line #1", "SB-30 Rubber Roll", 800), ("Mill Line #2", "Satake SB-50", 1200)]
    for name, model, cap in rows:
        db.add(
            MillingEquipment(
                company_id=company_id,
                branch_id=branch_id,
                name=name,
                model=model,
                capacity_kg_per_hr=Decimal(str(cap)),
                is_active=True,
            )
        )
    return f"equipment: +{len(rows)}"


def _seed_expense_categories(db, company_id):
    before = db.query(ExpenseCategory).count()
    seed_default_expense_categories(db, company_id)
    added = db.query(ExpenseCategory).count() - before
    return f"expense_categories: +{added}" if added else "expense_categories: skip"


def _seed_purchases(db, company_id, branch_id):
    if db.query(PalayPurchase).count():
        return "palay_purchases: skip"
    db.flush()  # make suppliers added earlier this txn visible to the query
    suppliers = db.query(Supplier).all()
    varieties = db.query(RiceVariety).limit(3).all()
    grades = db.query(QualityGrade).limit(2).all()
    if not suppliers or not varieties or not grades:
        return "palay_purchases: skip (need suppliers/varieties/grades)"
    today = date.today()
    n = 0
    for i in range(5):
        pur = PalayPurchase(
            company_id=company_id,
            branch_id=branch_id,
            warehouse_id=default_warehouse_id(db, branch_id),
            reference_no=f"PO-{today.year}-{i + 1:04d}",
            supplier_id=suppliers[i % len(suppliers)].id,
            purchase_date=today - timedelta(days=i * 4),
            delivery_type=choice(["farm_gate", "delivered"]),
            status="completed",
            remarks="Demo purchase",
        )
        db.add(pur)
        db.flush()
        for _ in range(2):
            gross = Decimal(str(choice([1500, 2000, 2500, 3000])))
            db.add(
                PalayPurchaseItem(
                    purchase_id=pur.id,
                    variety_id=choice(varieties).id,
                    grade_id=choice(grades).id,
                    gross_weight_kg=gross,
                    tare_weight_kg=Decimal("20"),
                    cavan_count=(gross - 20) / 50,
                    moisture_content_pct=Decimal(str(round(uniform(13, 16), 1))),
                    price_per_cavan=Decimal(str(choice([1150, 1200, 1250, 1300]))),
                )
            )
        n += 1
    return f"palay_purchases: +{n} (with items)"


def _seed_milling_batches(db, company_id, branch_id):
    if db.query(MillingBatch).count():
        return "milling_batches: skip"
    db.flush()  # make equipment added earlier this txn visible to the query
    equipment = db.query(MillingEquipment).all()
    varieties = db.query(RiceVariety).limit(3).all()
    grades = db.query(QualityGrade).limit(2).all()
    if not equipment or not varieties:
        return "milling_batches: skip (need equipment/varieties)"
    now = datetime.now(timezone.utc)
    n = 0
    for i in range(4):
        start = now - timedelta(days=i * 2, hours=3)
        batch = MillingBatch(
            company_id=company_id,
            branch_id=branch_id,
            batch_no=f"MB-{start.year}-{i + 1:04d}",
            equipment_id=equipment[i % len(equipment)].id,
            start_datetime=start,
            end_datetime=start + timedelta(hours=4),
            status="completed",
            remarks="Demo milling batch",
        )
        db.add(batch)
        db.flush()
        input_kg = Decimal(str(choice([2000, 2500, 3000])))
        db.add(
            MillingBatchInput(
                batch_id=batch.id,
                variety_id=varieties[i % len(varieties)].id,
                grade_id=grades[i % len(grades)].id if grades else None,
                input_weight_kg=input_kg,
                moisture_content_pct=Decimal("14.0"),
            )
        )
        milled = (input_kg * Decimal("0.65")).quantize(Decimal("0.001"))
        db.add(
            MillingBatchOutput(
                batch_id=batch.id,
                output_type="milled_rice",
                variety_id=varieties[i % len(varieties)].id,
                output_weight_kg=milled,
                broken_rice_pct=Decimal("8.5"),
                milling_recovery_pct=Decimal("65.0"),
            )
        )
        for bp, pct in (("ipa", "0.20"), ("darak", "0.10"), ("binlid", "0.05")):
            db.add(
                MillingBatchOutput(
                    batch_id=batch.id,
                    output_type=bp,
                    output_weight_kg=(input_kg * Decimal(pct)).quantize(Decimal("0.001")),
                )
            )
        n += 1
    return f"milling_batches: +{n} (with inputs/outputs)"


def _seed_agents(db, company_id, branch_id):
    if db.query(Agent).count():
        return "agents: skip"
    rows = [
        ("RJ Delivery Services", "broker", "RJ Mendoza", "0920-300-4001", "2.5"),
        ("FastTrack Logistics", "logistics_co", "Fe Ramos", "0920-300-4002", "3.0"),
        ("Bayan Freelance Haulers", "freelancer", "Boy Santos", "0920-300-4003", "1.5"),
    ]
    for name, atype, contact, phone, comm in rows:
        db.add(
            Agent(
                company_id=company_id,
                branch_id=branch_id,
                name=name,
                agent_type=atype,
                contact_person=contact,
                phone=phone,
                commission_pct=Decimal(comm),
                is_active=True,
            )
        )
    return f"agents: +{len(rows)}"


def _seed_millers(db, company_id, branch_id):
    if db.query(Miller).count():
        return "millers: skip"
    rows = [
        ("Santos Rice Mill (3rd-party)", "Tonyo Santos", "0921-400-5001", "1500", "1.25"),
        ("Valley Custom Milling", "Grace Lim", "0921-400-5002", "1000", "1.10"),
    ]
    for name, contact, phone, cap, fee in rows:
        db.add(
            Miller(
                company_id=company_id,
                branch_id=branch_id,
                name=name,
                contact_person=contact,
                phone=phone,
                capacity_kg_per_hr=Decimal(cap),
                milling_fee_per_kg=Decimal(fee),
                is_active=True,
            )
        )
    return f"millers: +{len(rows)}"


def _seed_drivers(db, company_id, branch_id):
    if db.query(Driver).count():
        return "drivers: skip"
    rows = [("Ernesto Castro", "0917-100-2003", "N01-12-345678"), ("Mario Gomez", "0917-100-2010", "N01-12-987654")]
    for name, phone, lic in rows:
        db.add(
            Driver(company_id=company_id, branch_id=branch_id, name=name, phone=phone, license_no=lic, is_active=True)
        )
    return f"drivers: +{len(rows)}"


def _seed_trucks(db, company_id, branch_id):
    if db.query(Truck).count():
        return "trucks: skip"
    rows = [("ABC-1234", "canter", "18"), ("XYZ-5678", "forward", "22")]
    for plate, ttype, fuel in rows:
        db.add(
            Truck(
                company_id=company_id,
                branch_id=branch_id,
                plate_number=plate,
                truck_type=ttype,
                fuel_consumption_l_per_100km=Decimal(fuel),
                is_active=True,
            )
        )
    return f"trucks: +{len(rows)}"


def _seed_dispatch_trips(db, company_id, branch_id):
    if db.query(DispatchTrip).count():
        return "dispatch_trips: skip"
    db.flush()  # make trucks/drivers added earlier this txn visible
    trucks = db.query(Truck).all()
    drivers = db.query(Driver).all()
    if not trucks or not drivers:
        return "dispatch_trips: skip (need trucks/drivers)"
    today = date.today()
    dests = ["Cabanatuan City Market", "SM Pampanga", "NFA Warehouse, Tarlac"]
    statuses = ["completed", "in_transit", "planned"]
    n = 0
    for i in range(3):
        db.add(
            DispatchTrip(
                company_id=company_id,
                branch_id=branch_id,
                trip_no=f"TRIP-{today.year}-{i + 1:04d}",
                truck_id=trucks[i % len(trucks)].id,
                driver_id=drivers[i % len(drivers)].id,
                dispatch_date=today - timedelta(days=i * 2),
                fuel_used_l=Decimal(str(choice([25, 30, 40]))),
                destination=dests[i],
                status=statuses[i],
                notes="Demo trip",
            )
        )
        n += 1
    return f"dispatch_trips: +{n}"


def _seed_pallets(db, company_id, branch_id):
    layout = WarehouseLayoutRepository(db).get_default_for_branch(branch_id)
    if not layout:
        return "pallets: skip (no warehouse layout)"
    if db.query(Pallet).filter(Pallet.layout_id == layout.id).count():
        return "pallets: skip"
    zone = (
        db.query(WarehouseZone)
        .filter(WarehouseZone.layout_id == layout.id, WarehouseZone.zone_type.like("%storage%"))
        .first()
    )
    if not zone:
        zone = db.query(WarehouseZone).filter(WarehouseZone.layout_id == layout.id).first()
    if not zone:
        return "pallets: skip (no zones)"
    varieties = db.query(RiceVariety).all()
    if not varieties:
        return "pallets: skip (no varieties)"
    clients = ["Juan dela Cruz Farms", "San Isidro Co-op", "Reyes Grains", "Mill stock"]
    today = date.today()
    start_x, start_y, cols = float(zone.x_m) + 0.4, float(zone.y_m) + 0.7, 6
    n = 0
    for i in range(12):
        x = start_x + (i % cols) * 1.5
        y = start_y + (i // cols) * 1.1
        sacks = choice([20, 25, 30])
        wt = Decimal(str(sacks * 50))
        client = choice(clients)
        age = choice([5, 30, 60, 90, 140, 175])
        milled = today - timedelta(days=age)
        moisture = Decimal(str(round(uniform(12.5, 15.5), 1)))
        pallet = Pallet(
            company_id=company_id,
            layout_id=layout.id,
            zone_id=zone.id,
            pallet_code=_next_pallet_code(db, company_id),
            x_m=Decimal(str(round(x, 2))),
            y_m=Decimal(str(round(y, 2))),
            z_layer=0,
            width_m=Decimal("2.0"),
            depth_m=Decimal("1.2"),
            sack_count=sacks,
            weight_kg=wt,
            status="in_storage",
        )
        db.add(pallet)
        db.flush()
        db.add(
            RiceBatch(
                company_id=company_id,
                pallet_id=pallet.id,
                variety_id=choice(varieties).id,
                client_type="mill_own" if client == "Mill stock" else "supplier",
                client_name=client,
                sack_count=sacks,
                weight_kg=wt,
                moisture_pct=moisture,
                milling_date=milled,
                best_before_date=compute_best_before(milled, moisture),
                status=aging_status(milled, moisture, today),
                notes=f"Demo pallet — {age}d aged",
            )
        )
        n += 1
    return f"pallets: +{n}"


def seed_company(username: str) -> str:
    control = SessionLocal()
    try:
        user = control.query(User).filter(User.username == username).first()
        if not user or not user.company_id:
            return f"{username}: not found or has no company — skipped"
        company = user.company
        branch = control.query(Branch).filter(Branch.company_id == company.id).first()
        if not branch:
            return f"{username}: no branch — skipped"
        company_id, branch_id = company.id, branch.id
    finally:
        control.close()

    db = session_for_company(company)
    try:
        steps = [
            _seed_suppliers(db, company_id, branch_id),
            _seed_customers(db, company_id, branch_id),
            _seed_employees(db, company_id, branch_id),
            _seed_equipment(db, company_id, branch_id),
            _seed_expense_categories(db, company_id),
            _seed_purchases(db, company_id, branch_id),
            _seed_milling_batches(db, company_id, branch_id),
            _seed_agents(db, company_id, branch_id),
            _seed_millers(db, company_id, branch_id),
            _seed_drivers(db, company_id, branch_id),
            _seed_trucks(db, company_id, branch_id),
            _seed_dispatch_trips(db, company_id, branch_id),
            _seed_pallets(db, company_id, branch_id),
        ]
        db.commit()
        return f"{username}: " + " | ".join(steps)
    except Exception as e:
        db.rollback()
        print(f"[{username}] ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--all"]:
        targets = [f"mill{i}" for i in range(1, 9)]
    elif args:
        targets = args
    else:
        targets = ["mill1"]
    for t in targets:
        print(seed_company(t))
