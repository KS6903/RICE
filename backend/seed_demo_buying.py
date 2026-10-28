"""Seed the Buy & mill pages for a test tenant: what's bought, and what's sold.

Purchases: two rice and two by-product purchases, recorded through BuyingService
as the mill's owner, so the stock they add is exactly what the app would add.
Where the mill has a "2nd Branch" warehouse, one of each goes there, to show the
warehouse choice. Skipped when the tenant already has any rice or by-product
purchase.

Sales: a palay sale, plus a rice and a by-product sale where the mill has none
yet, through SalesService, so each page's Sales side has something in it.
Skipped when the tenant already sells palay.

Run AFTER `alembic upgrade head`, `migrate_all_tenants.py` and the base demo
(it uses the base demo's suppliers when there are any).

Usage: python seed_demo_buying.py [username ...]     # default: mill1
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.core.tenancy import set_search_path
from app.models.buying import ByproductPurchase, RicePurchase
from app.models.company import Branch
from app.models.reference import QualityGrade, RiceVariety
from app.models.sales import SalesOrderItem
from app.models.supplier_customer import Supplier
from app.models.user import User
from app.repositories.inventory import ByproductInventoryRepository, MilledRiceInventoryRepository
from app.repositories.sales import (
    CustomerRepository,
    InvoiceRepository,
    PriceListRepository,
    SalesOrderRepository,
)
from app.schemas.buying import ByproductPurchaseCreate, RicePurchaseCreate
from app.schemas.sales import CustomerCreate, OrderCreate
from app.services.buying_service import BuyingService
from app.services.sales_service import SalesService

REMARK = "Demo purchase"


def seed(db, username: str) -> str:
    """Seed one tenant's purchases and sales; say what happened."""
    user = db.query(User).filter(User.username == username, User.company_id.is_not(None)).first()
    if not user:
        return f"{username}: not found or has no company — skipped"
    set_search_path(db, user.company.schema_name)
    return f"{username}: {_purchases(db, user)}; {_sales(db, user)}"


def _purchases(db, user) -> str:
    if db.query(RicePurchase).count() or db.query(ByproductPurchase).count():
        return "purchases already seeded"

    varieties = db.query(RiceVariety).limit(2).all()
    if not varieties:
        return "no varieties for purchases (run seed.py first)"
    supplier = db.query(Supplier).filter(Supplier.company_id == user.company_id).first()
    second = (
        db.query(Branch)
        .filter(Branch.company_id == user.company_id, Branch.name == "2nd Branch", Branch.deleted_at.is_(None))
        .first()
    )
    svc = BuyingService(
        db,
        user,
        milled=MilledRiceInventoryRepository(db),
        byproducts=ByproductInventoryRepository(db),
    )
    today = date.today()
    common = {"supplier_id": supplier.id if supplier else None, "remarks": REMARK}

    svc.create_rice_purchase(
        RicePurchaseCreate(
            **common,
            purchase_date=today - timedelta(days=12),
            delivery_type="delivered",
            items=[
                {
                    "variety_id": varieties[0].id,
                    "grade_name": "Graded Rice",
                    "sack_count": Decimal("40"),
                    "price_per_sack": Decimal("2450"),
                },
                {
                    "variety_id": varieties[-1].id,
                    "grade_name": "Straight Mill Rice",
                    "sack_count": Decimal("20"),
                    "kg_per_sack": Decimal("25"),
                    "price_per_sack": Decimal("1150"),
                },
            ],
        )
    )
    svc.create_rice_purchase(
        RicePurchaseCreate(
            **common,
            branch_id=second.id if second else None,
            purchase_date=today - timedelta(days=3),
            delivery_type="picked_up",
            items=[
                {
                    "variety_id": varieties[0].id,
                    "grade_name": "Graded Rice",
                    "sack_count": Decimal("25"),
                    "price_per_sack": Decimal("2400"),
                }
            ],
        )
    )
    svc.create_byproduct_purchase(
        ByproductPurchaseCreate(
            **common,
            purchase_date=today - timedelta(days=9),
            delivery_type="delivered",
            items=[
                {"byproduct_type": "darak", "weight_kg": Decimal("800"), "price_per_kg": Decimal("14")},
                {"byproduct_type": "ipa", "weight_kg": Decimal("1500"), "price_per_kg": Decimal("2")},
            ],
        )
    )
    svc.create_byproduct_purchase(
        ByproductPurchaseCreate(
            **common,
            branch_id=second.id if second else None,
            purchase_date=today - timedelta(days=1),
            delivery_type="picked_up",
            items=[{"byproduct_type": "binlid", "weight_kg": Decimal("400"), "price_per_kg": Decimal("28")}],
        )
    )
    where = " (one of each in 2nd Branch)" if second else ""
    return f"2 rice and 2 by-product purchases{where}"


def _sales(db, user) -> str:
    sold = {t for (t,) in db.query(SalesOrderItem.item_type).distinct()}
    if "palay" in sold:
        return "sales already seeded"
    variety = db.query(RiceVariety).first()
    grade = db.query(QualityGrade).first()
    svc = SalesService(
        db,
        user,
        customers=CustomerRepository(db),
        prices=PriceListRepository(db),
        orders=SalesOrderRepository(db),
        invoices=InvoiceRepository(db),
    )
    customer = db.query(svc.customers.model).filter_by(company_id=user.company_id).first()
    if customer is None:
        customer = svc.create_customer(CustomerCreate(name="Demo Trader", customer_type="wholesaler"))
    today = date.today()

    def order(days_ago: int, item: dict) -> None:
        svc.create_order(
            OrderCreate(
                customer_id=customer.id,
                order_date=today - timedelta(days=days_ago),
                remarks=REMARK.replace("purchase", "sale"),
                # The owner records it; an Enterprise credit limit shouldn't stop a demo.
                approve_over_limit=True,
                items=[item],
            )
        )

    made = ["palay"]
    order(
        6,
        {
            "item_type": "palay",
            "variety_id": variety.id if variety else None,
            "grade_name": grade.code if grade else None,
            "quantity_kg": Decimal("2000"),
            "unit_price_per_kg": Decimal("23"),
        },
    )
    if "milled_rice" not in sold:
        made.append("rice")
        order(
            4,
            {
                "item_type": "milled_rice",
                "variety_id": variety.id if variety else None,
                "grade_name": "Graded Rice",
                "quantity_kg": Decimal("500"),
                "unit_price_per_kg": Decimal("52"),
            },
        )
    if "byproduct" not in sold:
        made.append("by-product")
        order(
            2,
            {
                "item_type": "byproduct",
                "byproduct_type": "darak",
                "quantity_kg": Decimal("300"),
                "unit_price_per_kg": Decimal("16"),
            },
        )
    return f"{', '.join(made)} sale(s) to {customer.name}"


def main() -> None:
    import sys

    from app.core.database import SessionLocal

    for username in sys.argv[1:] or ["mill1"]:
        db = SessionLocal()
        try:
            print(seed(db, username))
        finally:
            db.close()


if __name__ == "__main__":
    main()
