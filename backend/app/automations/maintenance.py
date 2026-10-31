"""Machine servicing: due by running hours, tonnes milled, or days.

Start from the manufacturer's intervals. Use since the last service comes from
the milling batches finished since: their running time and the palay milled.
A machine is due once any interval is reached, and "due soon" from 90% of it.
The automation reports a machine when it turns due soon or due, once each
until it's serviced; recording the service starts the count again.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..jobs.schedule import daily
from ..models.maintenance import Equipment
from ..models.milling import MillingBatch, MillingBatchInput
from .base import Field, Notice, Recipe, RecipeContext
from .format import plural
from .state import newly_true

SOON = Decimal("0.9")


@dataclass(frozen=True)
class Usage:
    hours: Decimal
    tonnes: Decimal
    days: int

    def shares(self, e: Equipment) -> list[tuple[str, Decimal]]:
        """Each interval set, and how much of it is used (1 = due)."""
        out = []
        if e.every_hours:
            out.append(("hours", self.hours / e.every_hours))
        if e.every_tonnes:
            out.append(("tonnes", self.tonnes / Decimal(e.every_tonnes)))
        if e.every_days:
            out.append(("days", Decimal(self.days) / e.every_days))
        return out

    def status(self, e: Equipment) -> str:
        worst = max((share for _, share in self.shares(e)), default=Decimal(0))
        return "due" if worst >= 1 else "soon" if worst >= SOON else "ok"

    def describe(self, e: Equipment) -> str:
        parts = []
        if e.every_hours:
            parts.append(f"{self.hours:.0f} of {e.every_hours} running hours")
        if e.every_tonnes:
            parts.append(f"{self.tonnes:.1f} of {Decimal(e.every_tonnes):.0f} tonnes milled")
        if e.every_days:
            parts.append(f"{plural(self.days, 'day')} of {e.every_days}")
        return ", ".join(parts)


def usage(db: Session, e: Equipment, today: date, zone: ZoneInfo) -> Usage:
    """Milling from the day of the last service on: counting that whole day
    errs towards servicing early, never late."""
    since = datetime.combine(e.last_service_on, time(0, 0), tzinfo=zone)
    finished = [
        MillingBatch.status == "completed",
        MillingBatch.start_datetime >= since,
        MillingBatch.end_datetime.isnot(None),
    ]
    if e.milling_equipment_id is not None:
        finished.append(MillingBatch.equipment_id == e.milling_equipment_id)
    seconds = (
        db.query(func.sum(func.extract("epoch", MillingBatch.end_datetime - MillingBatch.start_datetime)))
        .filter(*finished)
        .scalar()
    )
    kilos = (
        db.query(func.sum(MillingBatchInput.input_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchInput.batch_id)
        .filter(*finished)
        .scalar()
    )
    return Usage(
        hours=Decimal(seconds or 0) / 3600,
        tonnes=Decimal(kilos or 0) / 1000,
        days=max(0, (today - e.last_service_on).days),
    )


class MaintenanceParams(BaseModel):
    email: bool = True


def _build(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    machines = ctx.db.query(Equipment).filter(Equipment.is_active.is_(True)).order_by(Equipment.name).all()
    states: dict[str, tuple[Equipment, Usage, str]] = {}
    for e in machines:
        use = usage(ctx.db, e, ctx.local_today, ctx.zone)
        state = use.status(e)
        if state != "ok":
            # Keyed by the service it's for: serviced, it's a new key.
            states[f"{e.id}:{e.last_service_on.isoformat()}:{state}"] = (e, use, state)
    new = newly_true(ctx, "maintenance_due", states)
    if not new:
        return []
    due = [states[k] for k in sorted(new, key=lambda k: states[k][0].name)]
    lines = [
        f"{e.name}: {'due now' if state == 'due' else 'due soon'}, {use.describe(e)} since {e.last_service_on:%d %b}"
        for e, use, state in due
    ]
    now_due = sum(1 for _, _, state in due if state == "due")
    title = (
        f"Machine servicing: {plural(now_due, 'machine')} due"
        if now_due
        else f"Machine servicing: {plural(len(due), 'machine')} due soon"
    )
    return [
        Notice(
            title=title,
            body="\n".join(lines) + "\nRecord the service on the Maintenance page when it's done.",
            link="/maintenance",
            dedupe_key=f"maintenance_due:{ctx.local_today.isoformat()}",
        )
    ]


RECIPE_DEF = Recipe(
    code="maintenance_due",
    title="Machine servicing",
    description=(
        "Each morning, a machine that has reached, or nearly reached, its service interval in running "
        "hours, tonnes milled or days, counted from the milling since its last service."
    ),
    group="production",
    section="milling",
    default_roles=("owner", "mill_operator"),
    params=MaintenanceParams,
    fields=(Field("email", "Also email it", "bool", "It always appears under the bell too."),),
    schedule=lambda _p: daily(time(7, 0)),
    build=_build,
)
