"""Owner watch recipes: each flags the right records, once, with the facts the
owner needs to judge them."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.engine import run_due_automations
from app.automations.recipes import RECIPES
from app.automations.recipes.watch import list_price
from app.jobs.registry import JobContext
from app.models.activity import ActivityLog
from app.models.automation import AutomationRule
from app.models.company import Company
from app.models.costs import Expense, ExpenseCategory
from app.models.milling import MillingBatch
from app.models.notification import Notification
from app.models.paddy import PalayPurchase, PalayPurchaseItem
from app.models.reference import RiceVariety
from app.models.sales import PriceList, SalesOrder, SalesOrderItem
from app.models.supplier_customer import Customer, Supplier
from app.models.user import Role, User

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-09-29T14:07+08:00")
TODAY = date(2026, 9, 29)
JUST_NOW = NOW - timedelta(minutes=10)
LONG_AGO = NOW - timedelta(days=3)


def _build(db_session, company, code, **params):
    recipe = RECIPES[code]
    ctx = RecipeContext(db=db_session, company=company, now=NOW, zone=MANILA)
    return recipe.build(ctx, recipe.params(**params))


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


@pytest.fixture
def variety(db_session, company) -> RiceVariety:
    v = RiceVariety(company_id=company.id, code="RC222", name="RC222")
    db_session.add(v)
    db_session.flush()
    return v


@pytest.fixture
def encoder(db_session, seed_owner) -> User:
    role = Role(id=3, name="encoder")
    db_session.add(role)
    db_session.flush()
    user = User(
        company_id=seed_owner.company_id,
        branch_id=seed_owner.branch_id,
        username="enc1",
        email="enc1@test.local",
        password_hash=seed_owner.password_hash,
        full_name="Ena Coder",
        role_id=role.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _order(db_session, *, no, total, created_at=JUST_NOW, status="confirmed", customer=None, **extra) -> SalesOrder:
    order = SalesOrder(
        order_no=no,
        order_date=TODAY,
        total_amount=Decimal(total),
        subtotal=Decimal(extra.pop("subtotal", total)),
        status=status,
        customer_id=customer.id if customer else None,
        created_at=created_at,
        updated_at=extra.pop("updated_at", created_at),
        **extra,
    )
    db_session.add(order)
    db_session.flush()
    return order


def _purchase(db_session, *, ref, cavans, price, variety=None, day=TODAY, created_at=JUST_NOW, **extra):
    purchase = PalayPurchase(
        reference_no=ref,
        purchase_date=day,
        status=extra.pop("status", "completed"),
        created_at=created_at,
        updated_at=extra.pop("updated_at", created_at),
        **extra,
    )
    db_session.add(purchase)
    db_session.flush()
    item = PalayPurchaseItem(
        purchase_id=purchase.id,
        variety_id=variety.id if variety else None,
        gross_weight_kg=Decimal(cavans * 50 + 10),
        tare_weight_kg=Decimal(10),
        price_per_cavan=Decimal(price),
    )
    db_session.add(item)
    db_session.flush()
    return purchase, item


# ── big transaction ──────────────────────────────────────────────────────────


def test_big_sales_purchases_and_expenses_are_flagged(db_session, company, encoder):
    customer = Customer(name="Aling Nena Store", credit_limit=0, payment_terms_days=0)
    supplier = Supplier(name="Mang Ben")
    db_session.add_all([customer, supplier])
    db_session.flush()
    _order(db_session, no="SO-BIG", total=150_000, customer=customer, created_by=encoder.id)
    _order(db_session, no="SO-SMALL", total=99_999)
    _order(db_session, no="SO-OLD", total=500_000, created_at=NOW - timedelta(days=2))
    _order(db_session, no="SO-VOID", total=500_000, status="cancelled")
    _purchase(db_session, ref="PP-BIG", cavans=200, price=1_100, supplier_id=supplier.id)  # ₱220,000
    _purchase(db_session, ref="PP-SMALL", cavans=100, price=1_100)  # ₱110,000
    db_session.add(Expense(expense_date=TODAY, amount=Decimal(25_000), description="Dryer motor", created_at=JUST_NOW))
    db_session.flush()

    notices = _build(db_session, company, "big_transaction")
    assert [(n.title, n.body) for n in notices] == [
        ("Big sale: ₱150,000", "SO-BIG to Aling Nena Store, dated 29 Sep. Entered by Ena Coder."),
        ("Big palay purchase: ₱220,000", "PP-BIG from Mang Ben, 10,000 kg."),
        ("Big expense: ₱25,000", "Uncategorised, dated 29 Sep. Dryer motor."),
    ]


def test_a_zero_limit_switches_that_kind_off(db_session, company):
    _order(db_session, no="SO-BIG", total=150_000)
    assert _build(db_session, company, "big_transaction", sale_over=0) == []


# ── palay price ──────────────────────────────────────────────────────────────


def test_a_palay_price_far_from_the_monthly_average_is_flagged(db_session, company, variety):
    for i, price in enumerate((1_200, 1_250, 1_300)):
        _purchase(
            db_session,
            ref=f"PP-H{i}",
            cavans=10,
            price=price,
            variety=variety,
            day=TODAY - timedelta(days=5 + i),
            created_at=LONG_AGO,
        )
    _, dear = _purchase(db_session, ref="PP-DEAR", cavans=10, price=1_500, variety=variety)
    dear.moisture_content_pct = Decimal("14.2")
    _purchase(db_session, ref="PP-FAIR", cavans=10, price=1_280, variety=variety)
    db_session.flush()

    [notice] = _build(db_session, company, "palay_price_outlier", percent=10)
    # 1,500 against the other four (1,200, 1,250, 1,300, 1,280 → 1,257.50): 19% above.
    assert notice.title == "Palay bought 19% above normal"
    assert notice.body == (
        "PP-DEAR from an unnamed supplier: RC222 at ₱1,500 a cavan. "
        "The last 30 days averaged ₱1,258 over 4 purchases. Moisture 14%."
    )


def test_no_price_alert_without_enough_history(db_session, company, variety):
    _purchase(db_session, ref="PP-H", cavans=10, price=1_000, variety=variety, created_at=LONG_AGO)
    _purchase(db_session, ref="PP-NEW", cavans=10, price=2_000, variety=variety)
    assert _build(db_session, company, "palay_price_outlier") == []


# ── after-the-fact edit ──────────────────────────────────────────────────────


def _edit_log(db_session, company, user, path, *, at=JUST_NOW, status=200, action="api.put"):
    log = ActivityLog(
        company_id=company.id,
        user_id=user.id,
        action=action,
        entity_type=path.split("/")[2],
        entity_label=path,
        detail=f"status={status}; request_id=abc",
        created_at=at,
    )
    db_session.add(log)
    db_session.flush()
    return log


def test_staff_changing_an_old_record_is_flagged(db_session, company, encoder, seed_owner):
    old = _order(db_session, no="SO-OLD", total=1_000, created_at=LONG_AGO)
    fresh = _order(db_session, no="SO-NEW", total=1_000, created_at=NOW - timedelta(hours=2))
    purchase, _ = _purchase(db_session, ref="PP-OLD", cavans=1, price=1_000, created_at=LONG_AGO)
    _edit_log(db_session, company, encoder, f"/api/sales/orders/{old.id}")
    _edit_log(db_session, company, encoder, f"/api/sales/orders/{fresh.id}")  # too recent to matter
    _edit_log(db_session, company, encoder, f"/api/paddy/purchases/{purchase.id}", status=422)  # refused
    _edit_log(db_session, company, seed_owner, f"/api/paddy/purchases/{purchase.id}")  # the owner's own
    _edit_log(db_session, company, encoder, f"/api/sales/customers/{uuid.uuid4()}")  # not a dated record

    [notice] = _build(db_session, company, "late_edit", older_than_hours=24)
    assert notice.title == "Old sales order changed: SO-OLD"
    assert notice.body == "Ena Coder changed SO-OLD on Tue 29 Sep, 13:57, 2 days after it was entered."


# ── discounts and prices ─────────────────────────────────────────────────────


def test_a_big_discount_is_flagged(db_session, company):
    _order(db_session, no="SO-D", total=9_200, subtotal=10_000, discount_pct=Decimal(8), discount_amount=Decimal(800))
    _order(db_session, no="SO-S", total=9_800, subtotal=10_000, discount_pct=Decimal(2), discount_amount=Decimal(200))
    [notice] = _build(db_session, company, "sale_pricing", discount_over=5)
    assert notice.title == "8% discount on SO-D"
    assert notice.body.splitlines() == ["To a walk-in customer.", "Discount: ₱800 off ₱10,000"]


def _price(variety, *, per_kg=None, sack=None, grade=None, customer_type=None, since=date(2026, 9, 1)):
    return PriceList(
        variety_id=variety.id,
        grade_name=grade,
        customer_type=customer_type,
        price_per_kg=per_kg,
        price_per_sack_50kg=sack,
        effective_date=since,
        is_active=True,
    )


def test_the_most_specific_price_list_entry_wins(variety):
    prices = [
        _price(variety, per_kg=Decimal(50)),
        _price(variety, per_kg=Decimal(48), grade="Premium"),
        _price(variety, sack=Decimal(2_300), grade="Premium", customer_type="wholesaler"),
        _price(variety, per_kg=Decimal(40), since=date(2026, 10, 15)),  # not yet in force
    ]
    assert list_price(prices, variety.id, "Premium", "wholesaler", TODAY) == Decimal(46)
    assert list_price(prices, variety.id, "Premium", "retail", TODAY) == Decimal(48)
    assert list_price(prices, variety.id, "Regular", None, TODAY) == Decimal(50)
    assert list_price(prices, uuid.uuid4(), None, None, TODAY) is None


def test_rice_sold_under_the_price_list_is_flagged(db_session, company, variety):
    db_session.add(_price(variety, per_kg=Decimal(48), grade="Premium"))
    order = _order(db_session, no="SO-CHEAP", total=22_000)
    db_session.add_all(
        [
            SalesOrderItem(
                order_id=order.id,
                item_type="milled_rice",
                variety_id=variety.id,
                grade_name="Premium",
                quantity_kg=Decimal(500),
                unit_price_per_kg=Decimal(44),
            ),
            SalesOrderItem(
                order_id=order.id,
                item_type="milled_rice",
                variety_id=variety.id,
                grade_name="Premium",
                quantity_kg=Decimal(100),
                unit_price_per_kg=Decimal("47.50"),  # within the 3% allowance
            ),
        ]
    )
    db_session.flush()
    [notice] = _build(db_session, company, "sale_pricing", below_list_by=3)
    assert notice.title == "SO-CHEAP sold below your price list"
    assert notice.body.splitlines() == [
        "To a walk-in customer.",
        "RC222 (grade Premium), 500 kg: ₱44.00/kg, list ₱48.00/kg (8% under)",
    ]


def test_a_discounted_sale_under_the_list_is_one_message_with_both_reasons(db_session, company, variety):
    db_session.add(_price(variety, per_kg=Decimal(48)))
    order = _order(
        db_session, no="SO-BOTH", total=20_240, subtotal=22_000, discount_pct=Decimal(8), discount_amount=Decimal(1_760)
    )
    db_session.add(
        SalesOrderItem(
            order_id=order.id,
            item_type="milled_rice",
            variety_id=variety.id,
            quantity_kg=Decimal(500),
            unit_price_per_kg=Decimal(44),
        )
    )
    db_session.flush()
    [notice] = _build(db_session, company, "sale_pricing")
    assert notice.title == "SO-BOTH: 8% discount and sold below your price list"
    assert notice.body.splitlines() == [
        "To a walk-in customer.",
        "Discount: ₱1,760 off ₱22,000",
        "RC222, 500 kg: ₱44.00/kg, list ₱48.00/kg (8% under)",
    ]
    assert notice.dedupe_key == f"sale_pricing:{order.id}"


# ── cancellations and expenses ───────────────────────────────────────────────


def test_cancellations_are_reported(db_session, company):
    _order(db_session, no="SO-X", total=5_000, status="cancelled", created_at=LONG_AGO, updated_at=JUST_NOW)
    _order(db_session, no="SO-Y", total=5_000, status="cancelled", created_at=LONG_AGO)  # cancelled long ago
    _purchase(
        db_session, ref="PP-X", cavans=2, price=1_000, status="cancelled", created_at=LONG_AGO, updated_at=JUST_NOW
    )
    db_session.add(
        MillingBatch(
            batch_no="MB-X",
            start_datetime=NOW - timedelta(hours=5),
            status="cancelled",
            created_at=NOW - timedelta(hours=5),
            updated_at=JUST_NOW,
        )
    )
    db_session.flush()
    assert [n.title for n in _build(db_session, company, "cancellations")] == [
        "Sales order cancelled: SO-X",
        "Palay purchase cancelled: PP-X",
        "Milling batch cancelled: MB-X",
    ]


def test_an_expense_far_above_its_category_usual_is_flagged(db_session, company):
    fuel = ExpenseCategory(company_id=company.id, name="Fuel")
    db_session.add(fuel)
    db_session.flush()
    for i in range(5):
        db_session.add(
            Expense(
                category_id=fuel.id,
                expense_date=TODAY - timedelta(days=10 + i),
                amount=Decimal(2_000),
                created_at=LONG_AGO,
            )
        )
    db_session.add(Expense(category_id=fuel.id, expense_date=TODAY, amount=Decimal(9_000), created_at=JUST_NOW))
    db_session.add(Expense(category_id=fuel.id, expense_date=TODAY, amount=Decimal(3_000), created_at=JUST_NOW))
    db_session.flush()
    [notice] = _build(db_session, company, "unusual_expense", times=3)
    assert notice.title == "Unusual expense: ₱9,000 for Fuel"
    # The usual excludes the expense itself but counts the other new one: (5×2,000 + 3,000) / 6.
    assert notice.body.startswith("That's 4.2× the usual ₱2,167 for Fuel")


# ── running every tick ───────────────────────────────────────────────────────


def test_a_watch_alert_goes_out_once_however_many_ticks_see_it(db_session, company, seed_owner):
    db_session.add(
        AutomationRule(company_id=company.id, recipe="big_transaction", enabled=True, params={}, recipients=[])
    )
    _order(db_session, no="SO-BIG", total=150_000)
    db_session.commit()
    for minutes in (0, 15, 30):
        now = NOW + timedelta(minutes=minutes)
        run_due_automations(JobContext(db=db_session, now=now, zone=MANILA, run_key="tick", company=company))
    db_session.expire_all()
    notices = db_session.query(Notification).filter(Notification.user_id == seed_owner.id).all()
    assert [n.title for n in notices] == ["Big sale: ₱150,000"]
