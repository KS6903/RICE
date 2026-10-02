"""Reports, summaries and people recipes, and the CSV that rides with a
scheduled report's email."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.csvfile import csv_attachment
from app.automations.engine import deliver
from app.automations.recipes import RECIPES
from app.automations.recipes.reports import last_month, last_week
from app.core import mailer as mailer_module
from app.models.company import Company
from app.models.costs import Expense
from app.models.employee import Employee
from app.models.milling import MillingBatch, MillingBatchInput, MillingBatchOutput
from app.models.notification import Notification, NotificationAttachment
from app.models.sales import Invoice, Payment, SalesOrder
from app.models.supplier_customer import Customer
from app.services import notification_service

MANILA = ZoneInfo("Asia/Manila")
MONDAY = datetime.fromisoformat("2026-09-28T07:05+08:00")
TODAY = date(2026, 9, 28)


def _build(db_session, company, code, *, now=MONDAY, **params):
    recipe = RECIPES[code]
    ctx = RecipeContext(db=db_session, company=company, now=now, zone=MANILA)
    return recipe.build(ctx, recipe.params(**params))


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


def _rows(attachment) -> list[list[str]]:
    text = attachment.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


# ── periods and CSV ──────────────────────────────────────────────────────────


def test_last_week_and_last_month():
    assert last_week(date(2026, 9, 28)) == (date(2026, 9, 21), date(2026, 9, 27))
    assert last_week(date(2026, 10, 4)) == (date(2026, 9, 21), date(2026, 9, 27))  # a Sunday
    assert last_month(date(2026, 10, 1)) == (date(2026, 9, 1), date(2026, 9, 30))
    assert last_month(date(2026, 1, 15)) == (date(2025, 12, 1), date(2025, 12, 31))


def test_csv_opens_in_excel_and_cannot_smuggle_a_formula():
    attachment = csv_attachment("x.csv", ("Name", "Amount"), [("=HYPERLINK(1)", Decimal("-5.50")), ("Ñora", 10)])
    assert attachment.content.startswith(b"\xef\xbb\xbf")  # a BOM, so Excel reads UTF-8
    assert _rows(attachment) == [["Name", "Amount"], ["'=HYPERLINK(1)", "-5.50"], ["Ñora", "10"]]


# ── scheduled report ─────────────────────────────────────────────────────────


def test_a_weekly_profit_and_loss_covers_last_week(db_session, company):
    for day, total in ((date(2026, 9, 22), 40_000), (date(2026, 9, 27), 10_000), (date(2026, 9, 28), 99_000)):
        db_session.add(
            SalesOrder(
                company_id=company.id, order_no=f"SO-{day}", order_date=day, total_amount=Decimal(total), status="paid"
            )
        )
    db_session.add(Expense(company_id=company.id, expense_date=date(2026, 9, 23), amount=Decimal(5_000)))
    db_session.flush()
    [notice] = _build(db_session, company, "scheduled_report", report="pnl", every="week")
    assert notice.title == "Profit and loss, last week (21–27 Sep)"
    assert notice.body.splitlines()[0] == "Sales (invoiced and paid orders): ₱50,000"
    assert notice.body.splitlines()[-1] == "Net profit: ₱45,000"
    [sheet] = notice.attachments
    assert sheet.filename == "profit-and-loss-2026-09-21-to-2026-09-27.csv"
    assert _rows(sheet)[1] == ["Sales (invoiced and paid orders)", "50000.0"]


def test_the_receivables_report_lists_every_open_invoice(db_session, company):
    nena = Customer(company_id=company.id, name="Aling Nena Store", credit_limit=0, payment_terms_days=0)
    db_session.add(nena)
    db_session.flush()
    db_session.add_all(
        [
            Invoice(
                company_id=company.id,
                invoice_no="INV-1",
                customer_id=nena.id,
                invoice_date=TODAY - timedelta(days=50),
                due_date=TODAY - timedelta(days=35),
                total_amount=Decimal(10_000),
                paid_amount=Decimal(4_000),
                status="overdue",
            ),
            Invoice(
                company_id=company.id,
                invoice_no="INV-2",
                customer_id=nena.id,
                invoice_date=TODAY,
                due_date=TODAY + timedelta(days=15),
                total_amount=Decimal(3_000),
                paid_amount=Decimal(0),
                status="unpaid",
            ),
        ]
    )
    db_session.flush()
    [notice] = _build(db_session, company, "scheduled_report", report="ar_aging", every="day")
    assert notice.title == "Who owes you: ₱9,000 as of 28 Sep"
    assert "31 to 60 days late: ₱6,000" in notice.body.splitlines()
    rows = _rows(notice.attachments[0])
    assert rows[0][0] == "Invoice"
    assert [r[0] for r in rows[1:]] == ["INV-1", "INV-2"]
    assert rows[1][-2:] == ["6000.00", "35"]


def test_a_report_csv_is_emailed_with_the_notice_once_per_report(db_session, company, seed_owner, monkeypatch):
    recipe = RECIPES["scheduled_report"]
    [notice] = _build(db_session, company, "scheduled_report", report="stock", every="day")
    deliver(db_session, company, recipe, [notice], [seed_owner.id], email=True)
    deliver(db_session, company, recipe, [notice], [seed_owner.id], email=True)  # a retried run
    db_session.flush()
    assert db_session.query(NotificationAttachment).count() == 1

    sent = []

    class FakeMailer:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return None

        def send(self, **message):
            sent.append(message)
            return True

    monkeypatch.setattr(notification_service, "Mailer", FakeMailer)
    assert notification_service.deliver_pending_emails(db_session, now=MONDAY)["sent"] == 1
    [message] = sent
    [attached] = message["attachments"]
    assert attached.filename == "stock-2026-09-28.csv"
    assert isinstance(attached, mailer_module.Attachment)
    # Two weeks on, the file is gone; the notice stays.
    assert notification_service.prune_attachments(db_session, now=datetime.now(timezone.utc) + timedelta(days=15)) == 1
    assert db_session.query(Notification).count() == 1


def test_in_app_only_reports_keep_no_file(db_session, company, seed_owner):
    [notice] = _build(db_session, company, "scheduled_report", report="stock", every="day")
    deliver(db_session, company, RECIPES["scheduled_report"], [notice], [seed_owner.id], email=False)
    db_session.flush()
    assert db_session.query(NotificationAttachment).count() == 0


# ── weekly summary ───────────────────────────────────────────────────────────


def test_the_weekly_summary_compares_with_the_week_before(db_session, company):
    for day, total in ((date(2026, 9, 22), 60_000), (date(2026, 9, 15), 50_000)):
        db_session.add(
            SalesOrder(order_no=f"SO-{day}", order_date=day, total_amount=Decimal(total), status="confirmed")
        )
    batch = MillingBatch(
        batch_no="MB-1",
        start_datetime=datetime.fromisoformat("2026-09-23T08:00+08:00"),
        end_datetime=datetime.fromisoformat("2026-09-23T16:00+08:00"),
        status="completed",
    )
    db_session.add(batch)
    db_session.flush()
    db_session.add_all(
        [
            MillingBatchInput(batch_id=batch.id, input_weight_kg=Decimal(1000)),
            MillingBatchOutput(batch_id=batch.id, output_type="milled_rice", output_weight_kg=Decimal(640)),
        ]
    )
    db_session.flush()
    [notice] = _build(db_session, company, "weekly_summary")
    assert notice.title == f"Last week at {company.name} (21–27 Sep)"
    lines = notice.body.splitlines()
    assert "Rice milled: 640 kg" in lines
    assert "Milling recovery: 64.0%" in lines
    assert "Sales: ₱60,000 (up 20% on the week before)" in lines


# ── cash-up ──────────────────────────────────────────────────────────────────


def test_the_cash_up_splits_today_by_method_and_by_who_took_the_cash(db_session, company, seed_owner):
    evening = datetime.fromisoformat("2026-09-28T18:05+08:00")
    db_session.add_all(
        [
            Payment(
                payment_date=TODAY, amount=Decimal(12_000), method="cash", received_by=seed_owner.id, created_at=evening
            ),
            Payment(
                payment_date=TODAY, amount=Decimal(3_000), method="cash", received_by=seed_owner.id, created_at=evening
            ),
            Payment(payment_date=TODAY, amount=Decimal(20_000), method="gcash", created_at=evening),
            Payment(payment_date=TODAY - timedelta(days=1), amount=Decimal(99_000), method="cash", created_at=evening),
        ]
    )
    db_session.flush()
    [notice] = _build(db_session, company, "cash_up", now=evening)
    assert notice.title == "Cash-up for Mon 28 Sep: ₱35,000 received"
    assert notice.body.splitlines() == [
        "GCash: ₱20,000 (1 payment)",
        "Cash: ₱15,000 (2 payments)",
        "Cash received by:",
        "Test Owner: ₱15,000",
    ]


@pytest.mark.parametrize("send_at", ["09:00", "23:30", "late"])
def test_the_cash_up_time_must_be_after_noon(send_at):
    with pytest.raises(ValueError):
        RECIPES["cash_up"].params(send_at=send_at)


# ── month end ────────────────────────────────────────────────────────────────


def test_month_end_runs_on_the_last_afternoon_of_the_month():
    due = RECIPES["month_end"].schedule(RECIPES["month_end"].params())
    assert due(datetime.fromisoformat("2026-09-30T15:59+08:00"), MANILA) is None
    assert due(datetime.fromisoformat("2026-09-30T16:00+08:00"), MANILA) == "2026-09"
    assert due(datetime.fromisoformat("2026-09-29T17:00+08:00"), MANILA) is None


def test_month_end_lists_what_is_still_open(db_session, company):
    now = datetime.fromisoformat("2026-09-30T16:05+08:00")
    db_session.add_all(
        [
            MillingBatch(batch_no="MB-OPEN", start_datetime=now - timedelta(hours=3), status="in_progress"),
            SalesOrder(order_no="SO-DRAFT", order_date=TODAY, status="draft"),
            SalesOrder(order_no="SO-OLD", order_date=TODAY - timedelta(days=20), status="confirmed", total_amount=1),
        ]
    )
    db_session.flush()
    [notice] = _build(db_session, company, "month_end", now=now)
    assert notice.title == "Closing September: 3 things to check"
    assert notice.body.splitlines() == [
        "Before you close the month:",
        "- 1 milling batch still open",
        "- 1 draft sales order",
        "- 1 order over a week old with no invoice",
    ]


def test_month_end_says_when_all_is_clear(db_session, company):
    [notice] = _build(db_session, company, "month_end", now=datetime.fromisoformat("2026-09-30T16:05+08:00"))
    assert notice.title == "Closing September: all clear"


# ── people ───────────────────────────────────────────────────────────────────


def test_employees_missing_government_numbers_are_listed(db_session, company):
    db_session.add_all(
        [
            Employee(
                first_name="Juan",
                last_name="Dela Cruz",
                position="Miller",
                sss_no="34-1234567-8",
                philhealth_no="",
                pagibig_no=None,
                tin="123-456-789",
                is_active=True,
            ),
            Employee(
                first_name="Ana",
                last_name="Reyes",
                sss_no="1",
                philhealth_no="2",
                pagibig_no="3",
                tin="4",
                is_active=True,
            ),
            Employee(first_name="Old", last_name="Hand", is_active=False),
        ]
    )
    db_session.flush()
    [notice] = _build(db_session, company, "government_ids")
    assert notice.title == "Missing government numbers: 1 employee"
    assert notice.body.splitlines()[0] == "Juan Dela Cruz (Miller): no PhilHealth, Pag-IBIG"
