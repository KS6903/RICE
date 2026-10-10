"""AI automations: the owner's switch gates them, DeepSeek's answer is checked,
a failed call still sends the figures, and nothing private reaches the model."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import pytest
from pydantic import SecretStr

from app.automations import ai
from app.automations.base import RecipeContext
from app.automations.engine import run_due_automations
from app.automations.recipes import RECIPES, advisor
from app.core import config as cfg
from app.jobs.registry import JobContext
from app.models.automation import AutomationRule, AutomationSettings
from app.models.company import Company
from app.models.costs import Expense
from app.models.employee import Employee
from app.models.milling import MilledRiceInventory, MillingBatch, MillingBatchInput, MillingBatchOutput
from app.models.notification import Notification
from app.models.paddy import PalayInventory, PalayPurchase, PalayPurchaseItem
from app.models.reference import RiceVariety
from app.models.sales import Invoice, SalesOrder, SalesOrderItem
from app.models.supplier_customer import Customer, Supplier
from app.models.user_location import UserLocation

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-10-05T08:40+08:00")  # a Monday
TODAY = date(2026, 10, 5)
AI_CODES = [code for code, r in RECIPES.items() if r.uses_ai]
ADVICE_CODES = [code for code, r in RECIPES.items() if r.ai_optional]


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(cfg.settings, "DEEPSEEK_AUTOMATIONS_API_KEY", SecretStr("test-key"), raising=False)


def _switch_ai(db_session, company, on=True, language="en"):
    db_session.add(AutomationSettings(company_id=company.id, ai_enabled=on, ai_language=language))
    db_session.flush()


def _reply(monkeypatch, *, content=None, status=200, finish="stop", calls=None):
    def fake_post(self, url, headers=None, json=None, **kw):
        if calls is not None:
            calls.append(json)
        body = {"choices": [{"message": {"content": content}, "finish_reason": finish}]}
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.Client, "post", fake_post)


KEYS = (ai.Key("headline", "x", limit=120), ai.Key("steps", "y", limit=200, is_list=True, max_items=3))


# ── the client ───────────────────────────────────────────────────────────────


def test_an_answer_is_read_tidied_and_checked_against_the_facts(key, monkeypatch):
    calls = []
    answer = {
        "headline": "Collect ₱120,038 from Aling Nena—today.",
        "steps": ["Call Aling Nena about ₱120,038.", "Raise prices to ₱58 a kilo.", ""],
        "ignored": "anything else the model adds",
    }
    _reply(monkeypatch, content=json.dumps(answer), calls=calls)
    out = ai.ask({"overdue_php": 120038}, KEYS, task="Chase money.", language="taglish")
    assert out == {"headline": "Collect ₱120,038 from Aling Nena, today.", "steps": ["Call Aling Nena about ₱120,038."]}
    [request] = calls
    assert request["model"] == "deepseek-v4-pro"
    assert request["response_format"] == {"type": "json_object"}
    assert "Taglish" in request["messages"][0]["content"]
    assert "Chase money." in request["messages"][0]["content"]
    assert json.loads(request["messages"][1]["content"]) == {"overdue_php": 120038}


@pytest.mark.parametrize(
    "reply",
    [
        {"status": 500, "content": "{}"},
        {"content": "not json"},
        {"content": "", "finish": "length"},
        {"content": json.dumps({"headline": "", "steps": []})},
    ],
)
def test_anything_short_of_a_usable_answer_is_unavailable(key, monkeypatch, reply):
    _reply(monkeypatch, **reply)
    with pytest.raises(ai.AIUnavailable):
        ai.ask({}, KEYS, task="t")


def test_without_a_key_nothing_is_sent(monkeypatch):
    monkeypatch.setattr(cfg.settings, "DEEPSEEK_AUTOMATIONS_API_KEY", None, raising=False)
    monkeypatch.setattr(cfg.settings, "DEEPSEEK_API_KEY", None, raising=False)
    with pytest.raises(ai.AIUnavailable):
        ai.ask({}, KEYS, task="t")


# ── languages ────────────────────────────────────────────────────────────────

KNOWN = ai.known_numbers({"overdue_php": 120038, "price": 58, "drop": 35})


@pytest.mark.parametrize(
    "text",
    [
        "把价格提高到每公斤₱99。",  # Chinese runs a figure straight up against its words
        "销量下降47%的原因是价格。",
        "应收款项₱130,000元。",
        "應收款項₱130,000元。",  # Traditional characters read the same way
        "銷量下降47%的原因是價格。",
        "ยอดขายลดลง47%เพราะราคา",  # and so does Thai
    ],
)
def test_an_invented_figure_is_caught_in_any_script(text):
    assert ai.unsupported_figures(text, KNOWN)


@pytest.mark.parametrize(
    "text", ["应收款项₱120,038元。", "應收款項₱120,038元。", "销量下降35%的原因是价格。", "ราคา₱58ต่อกิโลกรัม"]
)
def test_a_real_figure_passes_in_any_script(text):
    assert not ai.unsupported_figures(text, KNOWN)


def test_sentences_end_at_each_scripts_full_stop():
    split = lambda text: [s for s in ai._SENTENCE.split(text) if s]  # noqa: E731
    assert split("第一句。第二句。Third one. Fourth!") == ["第一句。", "第二句。", "Third one.", "Fourth!"]
    assert split("पहला वाक्य। दूसरा वाक्य।") == ["पहला वाक्य।", "दूसरा वाक्य।"]
    assert split("جملہ ایک۔ جملہ دو؟") == ["جملہ ایک۔", "جملہ دو؟"]


@pytest.mark.parametrize(
    ("language", "answer", "kept", "script"),
    [
        ("zh", "应收款项₱120,038元。价格提高到每公斤₱99。", "应收款项₱120,038元。", "Simplified Chinese"),
        ("zh-hant", "應收款項₱120,038元。價格提高到每公斤₱99。", "應收款項₱120,038元。", "Traditional Chinese"),
    ],
)
def test_only_the_sentence_with_the_invented_figure_is_dropped_from_a_chinese_answer(
    key, monkeypatch, language, answer, kept, script
):
    calls = []
    _reply(monkeypatch, content=json.dumps({"headline": answer, "steps": []}), calls=calls)
    out = ai.ask({"overdue_php": 120038}, KEYS, task="Chase money.", language=language)
    assert out == {"headline": kept, "steps": []}
    system = calls[0]["messages"][0]["content"]
    assert script in system and "digits 0-9" in system


def test_the_two_chinese_scripts_are_asked_for_by_name():
    simplified, traditional = ai.LANGUAGES["zh"], ai.LANGUAGES["zh-hant"]
    assert "Simplified Chinese" in simplified and "Traditional Chinese" in traditional
    assert "never simplified" in traditional


HOKKIEN = {
    "nan-ph": "Traditional",
    "nan-tw": "Traditional",
    "nan-fj": "Simplified",
    "nan-sg": "Simplified",
    "nan-my": "Simplified",
    "nan-id": "Simplified",
}


@pytest.mark.parametrize(("code", "script"), HOKKIEN.items())
def test_each_hokkien_region_is_asked_for_in_its_own_script_and_not_as_mandarin(code, script, key, monkeypatch):
    description = ai.LANGUAGES[code]
    assert description.startswith("Hokkien, ") and "not Mandarin" in description
    assert f"{script} Chinese characters" in description
    calls = []
    answer = {"headline": "應收款項₱120,038元。", "steps": []}
    _reply(monkeypatch, content=json.dumps(answer), calls=calls)
    out = ai.ask({"overdue_php": 120038}, KEYS, task="Chase money.", language=code)
    assert out["headline"] == "應收款項₱120,038元。"
    assert description in calls[0]["messages"][0]["content"]


def test_hokkien_is_offered_by_region_and_labelled_apart():
    labels = {code: ai.LANGUAGES[code].split(":")[0] for code in HOKKIEN}
    assert labels["nan-ph"] == "Hokkien, Philippines (咱人話)"
    assert labels["nan-tw"] == "Hokkien, Taiwan (臺語)"
    assert len(set(labels.values())) == len(HOKKIEN)  # no two regions share a label


def test_the_leading_rice_countries_languages_are_on_offer():
    assert {"en", "fil", "taglish", "zh", "zh-hant", "hi", "bn", "id", "vi", "th", "my", "km", "ur"} <= set(
        ai.LANGUAGES
    )
    labels = [description.split(":")[0] for description in ai.LANGUAGES.values()]
    assert len(set(labels)) == len(labels) and all(labels)
    assert all(len(code) <= 10 for code in ai.LANGUAGES)  # AutomationSettings.ai_language is String(10)


def test_the_language_is_any_on_offer_and_nothing_else(auth_client, seed_owner):
    res = auth_client.put("/api/automations/ai", json={"enabled": True, "language": "zh"})
    assert res.status_code == 200, res.text
    assert res.json()["language"] == "zh"
    listed = auth_client.get("/api/automations/").json()["ai"]
    assert listed["language"] == "zh"
    assert {"value": "zh", "label": "Simplified Chinese (简体中文)"} in listed["languages"]
    assert {"value": "zh-hant", "label": "Traditional Chinese (繁體中文)"} in listed["languages"]
    assert {"value": "id", "label": "Indonesian"} in listed["languages"]

    for code in ("zh-hant", "nan-ph", "nan-tw"):
        res = auth_client.put("/api/automations/ai", json={"enabled": True, "language": code})
        assert res.status_code == 200, res.text
        assert auth_client.get("/api/automations/").json()["ai"]["language"] == code
    assert {"value": "nan-ph", "label": "Hokkien, Philippines (咱人話)"} in listed["languages"]

    res = auth_client.put("/api/automations/ai", json={"enabled": True, "language": "xx"})
    assert res.status_code == 422


# ── the switch ───────────────────────────────────────────────────────────────


def _enable(db_session, company, code="ai_leakage_watch", **params):
    db_session.add(AutomationRule(company_id=company.id, recipe=code, enabled=True, params=params, recipients=[]))
    db_session.commit()


def _tick(db_session, company, *, ai_job):
    return run_due_automations(
        JobContext(db=db_session, now=NOW, zone=MANILA, run_key="tick", company=company), ai=ai_job
    )


QUIET = {"headline": "Quiet weeks.", "patterns": [], "all_clear": "Nothing stands out."}
ADVICE = {"headline": "A slow Sunday.", "summary": "Nothing sold.", "today": ["Chase the overdue invoices."]}


def test_ai_recipes_wait_for_the_owners_switch_and_run_in_their_own_job(db_session, company, key, monkeypatch):
    _reply(monkeypatch, content=json.dumps(QUIET))
    _enable(db_session, company)
    assert _tick(db_session, company, ai_job=False) == "no automations switched on"
    assert _tick(db_session, company, ai_job=True) == "1 AI automation(s) paused: AI is switched off"
    _switch_ai(db_session, company)
    assert _tick(db_session, company, ai_job=True) == "1 automation(s) ran, 0 failed"
    db_session.expire_all()
    [notice] = db_session.query(Notification).all()
    assert notice.title == "Unusual patterns to review: the last 28 days"
    assert notice.body.startswith("Quiet weeks.")


def test_the_morning_summary_adds_no_advice_while_ai_is_off(db_session, company, key, monkeypatch):
    calls: list = []
    _reply(monkeypatch, content=json.dumps(ADVICE), calls=calls)
    _enable(db_session, company, code="owner_digest", ai_advice=True)
    # The plain summary, in the quick job, and nothing reaches the model.
    assert _tick(db_session, company, ai_job=True) == "no automations switched on"
    assert _tick(db_session, company, ai_job=False) == "1 automation(s) ran, 0 failed"
    db_session.expire_all()
    [plain] = db_session.query(Notification).all()
    assert plain.body.startswith("Palay bought:")
    assert calls == []


def test_with_ai_on_the_morning_summary_opens_with_advice(db_session, company, key, monkeypatch):
    _reply(monkeypatch, content=json.dumps(ADVICE))
    _switch_ai(db_session, company)
    _enable(db_session, company, code="owner_digest", ai_advice=True)
    assert _tick(db_session, company, ai_job=False) == "no automations switched on"
    assert _tick(db_session, company, ai_job=True) == "1 automation(s) ran, 0 failed"
    db_session.expire_all()
    [notice] = db_session.query(Notification).all()
    assert notice.title.startswith("Yesterday at ")
    assert notice.body.splitlines()[:6] == [
        "A slow Sunday.",
        "Nothing sold.",
        "First today:",
        "1. Chase the overdue invoices.",
        "",
        "The figures:",
    ]
    assert "\n\nThe figures:\nPalay bought:" in notice.body


def test_when_deepseek_fails_the_figures_still_go_out(db_session, company, key, monkeypatch):
    _reply(monkeypatch, status=503, content="{}")
    _switch_ai(db_session, company)
    _enable(db_session, company, code="owner_digest", ai_advice=True)
    assert _tick(db_session, company, ai_job=True) == "1 automation(s) ran, 0 failed"
    db_session.expire_all()
    [notice] = db_session.query(Notification).all()
    assert notice.body.startswith("The AI advice couldn't be written this time. Here are the figures.")
    assert "\n\nThe figures:\nPalay bought: 0 kg for ₱0" in notice.body


def test_the_month_in_review_sends_its_spreadsheet_with_or_without_advice(db_session, company, key, monkeypatch):
    _reply(monkeypatch, content=json.dumps({"review": "A steady month. || Collections held.", "watch": []}))
    recipe = RECIPES["month_in_review"]
    first = datetime.fromisoformat("2026-10-01T08:05+08:00")
    plain = recipe.build(RecipeContext(db=db_session, company=company, now=first, zone=MANILA), recipe.params())
    advised = recipe.build(
        RecipeContext(db=db_session, company=company, now=first, zone=MANILA, ai=True), recipe.params(ai_advice=True)
    )
    for [notice] in (plain, advised):
        assert notice.title == "September in review"
        assert [a.filename for a in notice.attachments] == ["month-in-review-2026-09.csv"]
    assert plain[0].body.startswith("Sales: ₱0")
    assert advised[0].body.startswith("A steady month.\nCollections held.")


def test_only_the_owner_switches_ai_and_ai_recipes_need_it(auth_client, db_session, seed_owner):
    res = auth_client.put("/api/automations/ai_leakage_watch", json={"enabled": True})
    assert res.status_code == 400 and "Switch on AI" in res.json()["detail"]
    assert auth_client.post("/api/automations/ai_leakage_watch/test").status_code == 400

    res = auth_client.put("/api/automations/ai", json={"enabled": True, "language": "fil"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["enabled"], body["language"], body["changed_by"]) == (True, "fil", "Test Owner")
    listed = auth_client.get("/api/automations/").json()
    assert listed["ai"]["enabled"] is True
    assert {r["code"] for r in listed["recipes"] if r["uses_ai"]} == set(AI_CODES)
    assert {r["code"] for r in listed["recipes"] if r["ai_optional"]} == set(ADVICE_CODES)
    assert auth_client.put("/api/automations/ai_leakage_watch", json={"enabled": True}).status_code == 200

    from app.core.security import get_current_user
    from app.main import app
    from app.models.user import User

    admin = User(
        company_id=seed_owner.company_id,
        branch_id=seed_owner.branch_id,
        username="adm1",
        email="adm1@test.local",
        password_hash=seed_owner.password_hash,
        full_name="An Admin",
        role_id=2,  # seed_owner's fixture makes role 2 "admin"
        is_active=True,
    )
    db_session.add(admin)
    db_session.flush()
    app.dependency_overrides[get_current_user] = lambda: admin
    res = auth_client.put("/api/automations/ai", json={"enabled": False})
    assert res.status_code == 403
    assert res.json()["detail"] == "Only the mill's owner can change the AI settings."
    # Unusual patterns name staff: they go to the owner alone, not to this admin.
    candidates = auth_client.get("/api/automations/").json()["recipes"]
    [patterns] = [r for r in candidates if r["code"] == "ai_leakage_watch"]
    assert {c["role"] for c in patterns["candidates"]} == {"owner"}


def test_ai_tests_are_rate_limited(auth_client, monkeypatch):
    # The API client itself speaks httpx, so the model call is stubbed above it.
    monkeypatch.setattr(ai, "ask", lambda facts, keys, **kw: QUIET)
    auth_client.put("/api/automations/ai", json={"enabled": True})
    assert auth_client.post("/api/automations/ai_leakage_watch/test").json() == {"sent": 1}
    res = auth_client.post("/api/automations/ai_leakage_watch/test")
    assert res.status_code == 400 and "again in a few minutes" in res.json()["detail"]
    # Advice a plain recipe adds is rate-limited the same way.
    auth_client.put("/api/automations/owner_digest", json={"enabled": True, "params": {"ai_advice": True}})
    assert auth_client.post("/api/automations/owner_digest/test").json() == {"sent": 1}
    assert auth_client.post("/api/automations/owner_digest/test").status_code == 400


# ── what reaches the model ───────────────────────────────────────────────────

SECRETS = ("0917 555 0101", "123-456-789-000", "Purok 3, Brgy. San Roque", "34-1234567-8", "PRIVATE NOTE")


@pytest.fixture
def mill(db_session, company, seed_owner):
    """A small mill touching every recipe, with private details planted
    everywhere a careless query could pick them up."""
    variety = RiceVariety(company_id=company.id, code="RC222", name="NSIC Rc222", typical_recovery_pct=Decimal(66))
    customer = Customer(
        company_id=company.id,
        name="Aling Nena Store",
        customer_type="retailer",
        credit_limit=Decimal(50_000),
        payment_terms_days=7,
        phone=SECRETS[0],
        tin=SECRETS[1],
        address=SECRETS[2],
    )
    supplier = Supplier(company_id=company.id, name="Mang Ben", phone=SECRETS[0], address=SECRETS[2])
    db_session.add_all([variety, customer, supplier])
    db_session.flush()
    db_session.add(
        Employee(
            first_name="Juan", last_name="Cruz", sss_no=SECRETS[3], tin=SECRETS[1], phone=SECRETS[0], notes=SECRETS[4]
        )
    )
    for back in range(1, 20):
        day = TODAY - timedelta(days=back)
        at = datetime.combine(day, datetime.min.time(), tzinfo=MANILA) + timedelta(hours=9)
        purchase = PalayPurchase(
            reference_no=f"PP-{back}",
            purchase_date=day,
            status="completed",
            supplier_id=supplier.id,
            remarks=SECRETS[4],
            created_by=seed_owner.id,
            created_at=at,
            updated_at=at,
        )
        db_session.add(purchase)
        db_session.flush()
        db_session.add(
            PalayPurchaseItem(
                purchase_id=purchase.id,
                variety_id=variety.id,
                gross_weight_kg=Decimal(5010),
                tare_weight_kg=Decimal(10),
                price_per_cavan=Decimal(1150),
                moisture_content_pct=Decimal(20 if back == 1 else 14),
            )
        )
        batch = MillingBatch(
            batch_no=f"MB-{back}",
            start_datetime=at,
            end_datetime=at + timedelta(hours=8),
            status="completed",
            operator_id=seed_owner.id,
            remarks=SECRETS[4],
        )
        db_session.add(batch)
        db_session.flush()
        db_session.add_all(
            [
                MillingBatchInput(batch_id=batch.id, variety_id=variety.id, input_weight_kg=Decimal(5000)),
                MillingBatchOutput(
                    batch_id=batch.id, variety_id=variety.id, output_type="milled_rice", output_weight_kg=Decimal(3200)
                ),
            ]
        )
        order = SalesOrder(
            company_id=company.id,
            order_no=f"SO-{back}",
            customer_id=customer.id,
            order_date=day,
            total_amount=Decimal(100_000),
            subtotal=Decimal(100_000),
            status="invoiced",
            remarks=SECRETS[4],
            created_by=seed_owner.id,
            created_at=at,
            updated_at=at,
        )
        db_session.add(order)
        db_session.flush()
        db_session.add(
            SalesOrderItem(
                order_id=order.id,
                item_type="milled_rice",
                variety_id=variety.id,
                grade_name="A",
                quantity_kg=Decimal(2000),
                unit_price_per_kg=Decimal(50),
            )
        )
        db_session.add(
            Invoice(
                company_id=company.id,
                invoice_no=f"INV-{back}",
                order_id=order.id,
                customer_id=customer.id,
                invoice_date=day,
                due_date=day + timedelta(days=7),
                total_amount=Decimal(100_000),
                paid_amount=Decimal(0),
                status="overdue" if back > 7 else "unpaid",
            )
        )
        db_session.add(Expense(company_id=company.id, expense_date=day, amount=Decimal(3000), description=SECRETS[4]))
    db_session.add_all(
        [
            MilledRiceInventory(
                company_id=company.id, variety_id=variety.id, grade_name="A", quantity_kg=Decimal(5000)
            ),
            PalayInventory(company_id=company.id, variety_id=variety.id, quantity_kg=Decimal(20000)),
            UserLocation(user_id=seed_owner.id, label="Cabanatuan", lat=Decimal("15.49"), lon=Decimal("120.97")),
        ]
    )
    db_session.flush()


def test_every_ai_recipe_runs_and_sends_nothing_private(db_session, company, mill, key, monkeypatch):
    sent: list[dict] = []

    def fake_ask(facts, keys, *, task, language="en"):
        sent.append(facts)
        return {k.name: ([f"{k.name} one"] if k.is_list else f"{k.name} text") for k in keys}

    monkeypatch.setattr(ai, "ask", fake_ask)
    monkeypatch.setattr(
        advisor,
        "_forecast",
        lambda lat, lon: {"daily": [{"date": "2026-10-05", "condition": "Rain", "precip_pct": 80}], "hourly": []},
    )
    ctx = RecipeContext(db=db_session, company=company, now=NOW, zone=MANILA, test=True, ai=True)
    for code in AI_CODES + ADVICE_CODES:
        recipe = RECIPES[code]
        notices = recipe.build(ctx, recipe.params(ai_advice=True) if recipe.ai_optional else recipe.params())
        assert notices, f"{code} had nothing to say about a busy mill"
        assert "The figures:" in notices[0].body, code
    assert len(sent) == len(AI_CODES) + len(ADVICE_CODES)
    payload = json.dumps(sent, ensure_ascii=False, default=str)
    for secret in SECRETS:
        assert secret not in payload, f"{secret!r} reached the model"
    assert "Aling Nena Store" in payload  # names do go, with the owner's consent
