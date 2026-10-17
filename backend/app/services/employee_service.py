"""EmployeeService — business logic for the employees domain (Phase 3e).

Owns the (verbatim) employee serialization and branch-map enrichment that used
to live in the route module.
"""

from __future__ import annotations

import re
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, NotFoundError
from ..models.company import Branch
from ..models.employee import Employee
from ..repositories.employees import EmployeeRepository
from ..services.base import BaseService
from ..services.doc_numbers import employee_prefix

# A rate is what the employment type pays per day, week, hour and so on, so the
# monthly figure is worked out from it rather than typed in. A mill runs a
# six-day week: 26 working days a month, 8 hours a day.
WORK_DAYS_PER_MONTH = Decimal(26)
HOURS_PER_DAY = Decimal(8)
WEEKS_PER_MONTH = Decimal(52) / Decimal(12)
BIWEEKLY_PAYS_PER_MONTH = Decimal(2)  # Kinsenas: paid on the 15th and the 30th
# Paid by output or by sales: there is no fixed monthly figure to work out.
VARIABLE_PAY = {"piece_rate", "commission"}


def monthly_from_rate(employment_type: str | None, rate: Decimal | float | None) -> Decimal | None:
    """The monthly pay a rate comes to, by employment type; None when there is no
    rate or the pay is by output (piece-rate, commission)."""
    if rate is None:
        return None
    kind = (employment_type or "").strip().lower()
    if kind in VARIABLE_PAY:
        return None
    if kind == "monthly":
        factor = Decimal(1)
    elif kind == "biweekly":
        factor = BIWEEKLY_PAYS_PER_MONTH
    elif kind == "weekly":
        factor = WEEKS_PER_MONTH
    elif kind == "hourly":
        factor = HOURS_PER_DAY * WORK_DAYS_PER_MONTH
    else:
        # Daily, and the status types (regular, casual, ...): the rate is a day's pay.
        factor = WORK_DAYS_PER_MONTH
    return (Decimal(str(rate)) * factor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


PAY_METHODS = ("cash", "check", "bank_transfer", "e_wallet", "payroll_card")
PAY_FIELDS = ("pay_method", "pay_provider", "pay_account_name", "pay_account_no")
# What each account-based method needs, as the person would name it: what to
# call the method, the provider, and the number.
_ACCOUNT_METHODS = {
    "bank_transfer": ("bank transfer", "bank name", "account number"),
    "e_wallet": ("e-wallet", "e-wallet provider", "account number"),
    "payroll_card": ("payroll card", "bank or card issuer", "card or account number"),
}
_ACCOUNT_NO = re.compile(r"^\+?[0-9][0-9 \-]{3,38}$")


def settle_pay_details(values: dict, full_name: str) -> dict:
    """The pay method and the details it needs, checked and tidied.

    Cash needs nothing. A check goes to a payee (the employee's own name unless
    another is given). A bank transfer, e-wallet or payroll card needs the
    provider and the account, mobile or card number; the account holder is the
    employee unless another is given. Details a method doesn't use are dropped,
    so nothing stale lingers when the method changes.
    """

    def clean(key: str) -> str | None:
        return (values.get(key) or "").strip() or None

    method, provider, holder, number = (clean(k) for k in PAY_FIELDS)
    if method is None:
        if provider or holder or number:
            raise BadRequestError("Choose how this employee is paid before adding payment details.")
        return dict.fromkeys(PAY_FIELDS)
    if method not in PAY_METHODS:
        raise BadRequestError("Salary is paid by cash, check, bank transfer, e-wallet or payroll card.")
    out = dict.fromkeys(PAY_FIELDS)
    out["pay_method"] = method
    if method == "cash":
        return out
    if method == "check":
        out["pay_account_name"] = holder or full_name or None
        return out
    label, provider_label, number_label = _ACCOUNT_METHODS[method]
    if not provider:
        raise BadRequestError(f"Add the {provider_label} for the {label}.")
    if not number:
        raise BadRequestError(f"Add the {number_label} for the {label}.")
    if not _ACCOUNT_NO.match(number):
        raise BadRequestError(f"The {number_label} can only have numbers, spaces and dashes.")
    out.update(pay_provider=provider, pay_account_name=holder or full_name or None, pay_account_no=number)
    return out


class EmployeeService(BaseService):
    def __init__(self, db: Session, current_user: Any, *, employees: EmployeeRepository) -> None:
        super().__init__(db, current_user)
        self.employees = employees

    # ── reads ─────────────────────────────────────────────────────────────────

    def _branch_map(self) -> dict:
        rows = self.db.query(Branch).filter(Branch.company_id == self.current_user.company_id).all()
        return {str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch} for b in rows}

    @staticmethod
    def _serialize(e: Employee, branch_map: dict) -> dict:
        return {
            "id": str(e.id),
            "company_id": str(e.company_id) if e.company_id else None,
            "branch_id": str(e.branch_id) if e.branch_id else None,
            "branch": branch_map.get(str(e.branch_id)) if e.branch_id else None,
            "employee_no": e.employee_no,
            "first_name": e.first_name,
            "middle_name": e.middle_name,
            "last_name": e.last_name,
            "full_name": " ".join(filter(None, [e.first_name, e.middle_name, e.last_name])),
            "position": e.position,
            "department": e.department,
            "employment_type": e.employment_type,
            "date_hired": e.date_hired.isoformat() if e.date_hired else None,
            "date_terminated": e.date_terminated.isoformat() if e.date_terminated else None,
            "daily_rate": float(e.daily_rate) if e.daily_rate is not None else None,
            "monthly_salary": float(e.monthly_salary) if e.monthly_salary is not None else None,
            "pay_method": e.pay_method,
            "pay_provider": e.pay_provider,
            "pay_account_name": e.pay_account_name,
            "pay_account_no": e.pay_account_no,
            "phone": e.phone,
            "email": e.email,
            "address": e.address,
            "birthdate": e.birthdate.isoformat() if e.birthdate else None,
            "gender": e.gender,
            "civil_status": e.civil_status,
            "sss_no": e.sss_no,
            "philhealth_no": e.philhealth_no,
            "pagibig_no": e.pagibig_no,
            "tin": e.tin,
            "emergency_contact_name": e.emergency_contact_name,
            "emergency_contact_phone": e.emergency_contact_phone,
            "emergency_contact_relation": e.emergency_contact_relation,
            "notes": e.notes,
            "is_active": e.is_active,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }

    def list_employees(self, *, include_inactive: bool = True, branch_id: uuid.UUID | None = None) -> list[dict]:
        rows = self.employees.list_for_company(
            self.current_user.company_id, include_inactive=include_inactive, branch_id=branch_id
        )
        bmap = self._branch_map()
        return [self._serialize(e, bmap) for e in rows]

    def get_employee(self, employee_id: uuid.UUID) -> dict:
        e = self.employees.get_for_company(employee_id, self.current_user.company_id)
        if not e:
            raise NotFoundError("Employee not found")
        return self._serialize(e, self._branch_map())

    # ── writes ────────────────────────────────────────────────────────────────

    def next_employee_no(self, employment_type: str | None) -> str:
        """The number the next employee of this type would get (a preview)."""
        return self.employees.next_employee_no(self.current_user.company_id, employee_prefix(employment_type))

    def create_employee(self, data) -> dict:
        # IDOR guard: a client-supplied branch must belong to this company.
        self.assert_company_fk(Branch, data.branch_id, label="Branch")
        fields = {k: v for k, v in data.model_dump().items() if k != "branch_id"}
        full_name = " ".join(
            filter(None, [fields.get("first_name"), fields.get("middle_name"), fields.get("last_name")])
        )
        fields.update(settle_pay_details(fields, full_name))
        # The monthly figure follows from the rate and the employment type.
        if fields.get("daily_rate") is not None:
            fields["monthly_salary"] = monthly_from_rate(fields.get("employment_type"), fields["daily_rate"])
        with self.transaction():
            # The number comes from the employment type unless one was typed in.
            fields["employee_no"] = (fields.get("employee_no") or "").strip() or self.employees.next_employee_no(
                self.current_user.company_id, employee_prefix(fields.get("employment_type")), lock=True
            )
            e = Employee(
                company_id=self.current_user.company_id,
                branch_id=data.branch_id or self.current_user.branch_id,
                **fields,
            )
            self.employees.add(e)
        self.db.refresh(e)
        return self._serialize(e, self._branch_map())

    def update_employee(self, employee_id: uuid.UUID, data) -> dict:
        e = self.employees.get_for_company(employee_id, self.current_user.company_id)
        if not e:
            raise NotFoundError("Employee not found")
        self.assert_company_fk(Branch, data.branch_id, label="Branch")
        # Only the fields the caller sent are touched, and a sent null clears an
        # optional field (a termination date, a rate, an email). The name and
        # the active flag can't be cleared.
        changes = data.model_dump(exclude_unset=True)
        if any(changes[f] in (None, "") for f in ("first_name", "last_name") if f in changes):
            raise BadRequestError("First and last name are required.")
        if changes.get("is_active", True) is None:
            del changes["is_active"]
        # Payment details are checked as they will stand: what was sent over what
        # is stored. The employee is the default account holder or payee.
        if any(f in changes for f in PAY_FIELDS) or any(
            f in changes for f in ("first_name", "middle_name", "last_name")
        ):
            stands = {f: changes[f] if f in changes else getattr(e, f) for f in PAY_FIELDS}
            names = [changes[f] if f in changes else getattr(e, f) for f in ("first_name", "middle_name", "last_name")]
            changes.update(settle_pay_details(stands, " ".join(filter(None, names))))
        # Changing the rate or the employment type re-works the monthly figure. With
        # no rate behind it, a monthly figure the caller sent is left as it is; one
        # the caller didn't send goes with the rate it was worked out from.
        if "daily_rate" in changes or "employment_type" in changes:
            rate = changes["daily_rate"] if "daily_rate" in changes else e.daily_rate
            kind = changes["employment_type"] if "employment_type" in changes else e.employment_type
            if rate is not None:
                changes["monthly_salary"] = monthly_from_rate(kind, rate)
            elif "daily_rate" in changes and "monthly_salary" not in changes:
                changes["monthly_salary"] = None
        with self.transaction():
            for field, val in changes.items():
                setattr(e, field, val)
        self.db.refresh(e)
        return self._serialize(e, self._branch_map())
