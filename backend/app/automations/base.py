"""What a recipe is, and what it produces."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import TYPE_CHECKING, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..jobs.schedule import Schedule

if TYPE_CHECKING:
    from ..models.company import Company


@dataclass(frozen=True)
class Notice:
    """One message a recipe sends, the same to every recipient."""

    title: str
    body: str
    dedupe_key: str
    link: str | None = None


class RecipeProblem(Exception):
    """The recipe can't run as set up; the message tells the owner what to fix.
    A scheduled run records it as the run's failure, and "Send me a test"
    shows it."""


@dataclass(frozen=True)
class RecipeContext:
    db: Session  # on the tenant's schema
    company: Company
    now: datetime  # UTC
    zone: ZoneInfo  # the tenant's timezone
    # "Send me a test": show everything that is true now, and change nothing
    # (no remembered state), so a test can't swallow tomorrow's real alert.
    test: bool = False

    @property
    def local_now(self) -> datetime:
        return self.now.astimezone(self.zone)

    @property
    def local_today(self) -> date:
        return self.local_now.date()

    def local_day_bounds_utc(self, day: date) -> tuple[datetime, datetime]:
        """The instants a local calendar day starts and ends, as aware datetimes."""
        start = datetime.combine(day, time(0, 0), tzinfo=self.zone)
        return start, start + timedelta(days=1)


@dataclass(frozen=True)
class Field:
    """One setting as the Automations page shows it."""

    name: str
    label: str
    kind: Literal["time", "bool", "number", "money", "percent", "select"]
    help: str = ""
    unit: str = ""  # shown after a number, e.g. "hours"
    options: tuple[tuple[str, str], ...] = ()  # (value, label) for a select
    # A select whose options are the tenant's own records, filled in by the API:
    # "saved_locations" lists the weather locations the mill's users saved.
    options_from: str = ""


Group = Literal["reports", "watch", "production", "stock", "receivables", "deliveries", "people"]


@dataclass(frozen=True)
class Recipe:
    code: str
    title: str
    description: str  # one sentence, in the mill's terms
    group: Group
    # The app section a recipient needs at least view access to. A digest full
    # of financial figures needs "reports", so a cashier can't receive it.
    section: str
    # Who gets it when the owner hasn't picked anyone.
    default_roles: tuple[str, ...]
    params: type[BaseModel]
    fields: tuple[Field, ...]
    schedule: Callable[[BaseModel], Schedule]
    build: Callable[[RecipeContext, BaseModel], list[Notice]]
