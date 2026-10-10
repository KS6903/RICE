"""Who may undo a delivery, and for how long.

An order is marked delivered only once a courier is assigned (see
``DispatchService.mark_delivered``). The mill's owner can take that mark back, to
correct a slip, but only for a week: after that the delivery stands, since by then
it has been invoiced against, counted and reported.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..core.exceptions import ConflictError, PermissionDeniedError

EDIT_WINDOW = timedelta(days=7)


def has_courier(order) -> bool:
    """Whether someone is down to deliver the order: the customer, or the rice
    mill's courier (an agent or miller assigned before there were only those two
    options counts as the mill's)."""
    return bool(order.courier_type or order.assigned_agent_id or order.assigned_miller_id)


def delivered_on(order) -> datetime | None:
    """When the order was marked delivered (the last update, for old rows that
    were delivered before the time was kept)."""
    if order.status != "delivered":
        return None
    return order.delivered_at or order.updated_at


def edit_deadline(order) -> datetime | None:
    """The moment after which a delivered order can no longer be un-delivered."""
    when = delivered_on(order)
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when + EDIT_WINDOW


# A trip is open to edits until it leaves "planned"; from departing and delivering
# it stays editable for a week, then locks.
TRIP_LOCKING = ("in_transit", "completed")


def trip_status_since(trip) -> datetime | None:
    """When a departed or delivered trip got that status (the last update, for
    rows from before the time was kept). None for any other trip."""
    if trip.status not in TRIP_LOCKING:
        return None
    return trip.status_changed_at or trip.updated_at


def trip_edit_deadline(trip) -> datetime | None:
    """The moment after which a departed or delivered trip can no longer be edited."""
    when = trip_status_since(trip)
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when + EDIT_WINDOW


def is_owner(user) -> bool:
    role = getattr(getattr(user, "role", None), "name", None)
    return role == "owner" or bool(getattr(user, "is_platform_admin", False))


def _check(deadline: datetime | None, user, *, what: str, now: datetime | None) -> None:
    if not is_owner(user):
        raise PermissionDeniedError(f"Only the owner can take a {what} back.")
    if deadline is None:
        raise ConflictError(f"This isn't marked as a {what}.")
    if (now or datetime.now(timezone.utc)) > deadline:
        raise ConflictError(
            f"This {what} was marked more than {EDIT_WINDOW.days} days ago, so it can no longer be changed."
        )


def check_can_unmark(order, user, *, now: datetime | None = None) -> None:
    """Raise unless ``user`` may take the delivered mark off ``order`` right now."""
    _check(edit_deadline(order), user, what="delivery", now=now)


def check_trip_editable(trip, *, now: datetime | None = None) -> None:
    """Raise once a departed or delivered trip is past its week."""
    deadline = trip_edit_deadline(trip)
    if deadline is not None and (now or datetime.now(timezone.utc)) > deadline:
        raise ConflictError(
            f"This trip left or arrived more than {EDIT_WINDOW.days} days ago, so it can no longer be edited."
        )


def check_can_unmark_trip(trip, user, *, now: datetime | None = None) -> None:
    """Raise unless ``user`` may move ``trip`` back from departed or delivered."""
    _check(trip_edit_deadline(trip), user, what="trip status", now=now)
