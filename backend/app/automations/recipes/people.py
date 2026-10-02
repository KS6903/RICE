"""People: your team's paperwork."""

from __future__ import annotations

from datetime import time

from pydantic import BaseModel

from ...jobs.schedule import monthly
from ...models.employee import Employee
from ..base import Notice, Recipe, RecipeContext
from ..format import plural
from .watch import EMAIL_FIELD

# The numbers a Philippine employer reports contributions and taxes under.
GOVERNMENT_IDS = (("sss_no", "SSS"), ("philhealth_no", "PhilHealth"), ("pagibig_no", "Pag-IBIG"), ("tin", "TIN"))


class GovernmentIdParams(BaseModel):
    email: bool = True


def _missing_ids(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    employees = (
        ctx.db.query(Employee)
        .filter(Employee.is_active.is_(True), Employee.date_terminated.is_(None))
        .order_by(Employee.last_name, Employee.first_name)
        .all()
    )
    lines = []
    for e in employees:
        missing = [label for attr, label in GOVERNMENT_IDS if not (getattr(e, attr) or "").strip()]
        if missing:
            role = f" ({e.position})" if e.position else ""
            lines.append(f"{e.first_name} {e.last_name}{role}: no {', '.join(missing)}")
    if not lines:
        return []
    return [
        Notice(
            title=f"Missing government numbers: {plural(len(lines), 'employee')}",
            body="\n".join(lines) + "\nYou need these to remit contributions and withholding tax.",
            link="/employees",
            dedupe_key=f"government_ids:{ctx.local_today:%Y-%m}",
        )
    ]


GOVERNMENT_IDS_RECIPE = Recipe(
    code="government_ids",
    title="Missing government numbers",
    description="On the 1st of each month, active employees without an SSS, PhilHealth, Pag-IBIG or TIN number on file.",
    group="people",
    section="employees",
    default_roles=("owner",),
    params=GovernmentIdParams,
    fields=(EMAIL_FIELD,),
    schedule=lambda _params: monthly(1, time(8, 0)),
    build=_missing_ids,
)


PEOPLE_RECIPES = (GOVERNMENT_IDS_RECIPE,)
