"""Storage sensors, whatever the brand: anything that can call a web address sends its
readings to the mill's own secret link, as query text, a form or JSON. The Boss says which
field holds what, its temperature unit, a correction, and how often to keep a reading, so
no brand is built in. Left blank, the common field names are tried.

Readings go through SavingsService.add_reading, the same as typed ones: over a zone's
target, the Boss hears, and its pallets are held if the mill says so.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import FeatureRequiredError, NotFoundError, ValidationError
from ..core.tenancy import set_search_path
from ..models.company import Company
from ..models.subscription import Subscription
from ..models.user import User
from ..models.warehouse import StorageSensor, WarehouseLayout, WarehouseZone
from .profit_service import is_boss
from .savings_service import SavingsService
from .subscription import is_active

HUMIDITY_NAMES = ("humidity", "hum", "rh", "humidity_pct", "relative_humidity", "humidity_value")
TEMPERATURE_NAMES = ("temperature", "temp", "temp_c", "tc", "temperature_c", "temperature_value", "tmp")
PAYLOAD_KEPT = 1000
FEATURE = "profit"  # the Savings page's plan feature


def _number(value: Any) -> Decimal | None:
    if isinstance(value, bool) or value is None:
        return None
    text = str(value).strip().rstrip("%").rstrip("°CcFf ").strip()
    try:
        number = Decimal(text)
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def read_path(payload: Any, path: str) -> Any:
    """A value at a dotted path: ``sensor.0.humidity`` looks in nested objects and lists."""
    current = payload
    for part in path.split("."):
        if isinstance(current, dict):
            found = next((v for k, v in current.items() if str(k).lower() == part.lower()), None)
            current = found
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return None
    return current


def _find_name(payload: Any, names: tuple[str, ...]) -> Decimal | None:
    """The first of the common names, here or in anything nested."""
    if isinstance(payload, dict):
        for name in names:
            number = _number(read_path(payload, name))
            if number is not None:
                return number
        children = list(payload.values())
    elif isinstance(payload, list):
        children = payload
    else:
        return None
    for child in children:
        number = _find_name(child, names)
        if number is not None:
            return number
    return None


def _pick(payload: Any, field: str | None, names: tuple[str, ...]) -> Decimal | None:
    return _number(read_path(payload, field)) if field else _find_name(payload, names)


def read_payload(
    payload: Any,
    *,
    humidity_field: str | None = None,
    temp_field: str | None = None,
    temp_unit: str = "c",
    humidity_offset: Decimal = Decimal(0),
    temp_offset: Decimal = Decimal(0),
) -> tuple[Decimal | None, Decimal | None]:
    """Humidity % and temperature °C from what a sensor sent, corrected. A figure no
    gauge could read (over 100% humidity, say) counts as not sent."""
    humidity = _pick(payload, humidity_field, HUMIDITY_NAMES)
    temp = _pick(payload, temp_field, TEMPERATURE_NAMES)
    if humidity is not None:
        humidity = round(humidity + humidity_offset, 2)
        humidity = humidity if 0 <= humidity <= 100 else None
    if temp is not None:
        if temp_unit == "f":
            temp = (temp - 32) * 5 / 9
        temp = round(temp + temp_offset, 1)
        temp = temp if -20 <= temp <= 99 else None
    return humidity, temp


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def receive(db: Session, token: str, payload: Any, *, now: datetime | None = None) -> dict:
    """Keep what a sensor sent. The link names the mill (the schema to look in) and
    carries the secret; a wrong one of either looks the same from outside."""
    now = now or datetime.now(timezone.utc)
    company_part, _, secret = token.partition(".")
    try:
        company_id = uuid.UUID(hex=company_part)
    except ValueError:
        raise NotFoundError("Sensor not found") from None
    company = db.get(Company, company_id)
    if company is None or not secret:
        raise NotFoundError("Sensor not found")
    sub = db.query(Subscription).filter(Subscription.company_id == company.id).first()
    allowed = bool(sub and sub.plan and is_active(sub) and FEATURE in (sub.plan.features or []))
    boss = next((u for u in db.query(User).filter(User.company_id == company.id).all() if is_boss(u)), None)
    set_search_path(db, company.schema_name)  # the whole request is this mill's
    sensor = db.query(StorageSensor).filter(StorageSensor.token_hash == _hash(secret)).first()
    if sensor is None or boss is None:
        raise NotFoundError("Sensor not found")
    if not allowed:
        raise FeatureRequiredError("This mill's plan doesn't include sensors.")
    sensor.last_seen_at = now
    sensor.last_payload = json.dumps(payload, default=str)[:PAYLOAD_KEPT]
    humidity, temp = read_payload(
        payload,
        humidity_field=sensor.humidity_field,
        temp_field=sensor.temp_field,
        temp_unit=sensor.temp_unit,
        humidity_offset=sensor.humidity_offset or Decimal(0),
        temp_offset=sensor.temp_offset or Decimal(0),
    )
    if humidity is None and temp is None:
        db.commit()
        return {"saved": False, "reason": "no humidity or temperature found"}
    last = sensor.last_read_at
    if last is not None and now - last < timedelta(minutes=sensor.min_minutes):
        db.commit()
        return {"saved": False, "reason": "kept too recently"}
    sensor.last_read_at = now
    sensor.last_humidity_pct = humidity
    sensor.last_temp_c = temp
    name, zone_id = sensor.name, sensor.zone_id
    result = SavingsService(db, boss).add_reading(
        SimpleNamespace(zone_id=zone_id, humidity_pct=humidity, temp_c=temp, note=f"Sensor: {name}")
    )
    return {"saved": True, "out_of_range": result["out_of_range"]}


class SensorService(SavingsService):
    def _sensor(self, sensor_id: uuid.UUID) -> StorageSensor:
        sensor = self.db.get(StorageSensor, sensor_id)
        if sensor is None or sensor.company_id != self._company_id:
            raise NotFoundError("Sensor not found")
        return sensor

    def _check_zone(self, zone_id: uuid.UUID) -> None:
        zone = self.db.get(WarehouseZone, zone_id)
        layout = self.db.get(WarehouseLayout, zone.layout_id) if zone else None
        if layout is None or layout.company_id != self._company_id:
            raise ValidationError("Choose a storage zone.")

    def _link(self, secret: str) -> str:
        return f"/api/sensors/in/{self._company_id.hex}.{secret}"

    @staticmethod
    def _out(sensor: StorageSensor) -> dict:
        return {
            "id": str(sensor.id),
            "name": sensor.name,
            "zone_id": str(sensor.zone_id),
            "humidity_field": sensor.humidity_field or "",
            "temp_field": sensor.temp_field or "",
            "temp_unit": sensor.temp_unit,
            "humidity_offset": float(sensor.humidity_offset or 0),
            "temp_offset": float(sensor.temp_offset or 0),
            "min_minutes": sensor.min_minutes,
            "last_seen_at": sensor.last_seen_at,
            "last_read_at": sensor.last_read_at,
            "last_humidity_pct": float(sensor.last_humidity_pct) if sensor.last_humidity_pct is not None else None,
            "last_temp_c": float(sensor.last_temp_c) if sensor.last_temp_c is not None else None,
            "last_payload": sensor.last_payload,
        }

    def list_sensors(self) -> list[dict]:
        rows = self.db.query(StorageSensor).order_by(StorageSensor.created_at).all()
        return [self._out(s) for s in rows if s.company_id == self._company_id]

    def _apply(self, sensor: StorageSensor, data: Any) -> None:
        sensor.name = data.name.strip()
        sensor.zone_id = data.zone_id
        sensor.humidity_field = (data.humidity_field or "").strip() or None
        sensor.temp_field = (data.temp_field or "").strip() or None
        sensor.temp_unit = data.temp_unit
        sensor.humidity_offset = data.humidity_offset
        sensor.temp_offset = data.temp_offset
        sensor.min_minutes = data.min_minutes

    def add_sensor(self, data: Any) -> dict:
        """The link is shown this once: only its hash is kept."""
        self._check_zone(data.zone_id)
        secret = secrets.token_urlsafe(24)
        with self.transaction():
            sensor = StorageSensor(company_id=self._company_id, token_hash=_hash(secret))
            self._apply(sensor, data)
            self.db.add(sensor)
        return {**self._out(sensor), "link": self._link(secret)}

    def update_sensor(self, sensor_id: uuid.UUID, data: Any) -> dict:
        sensor = self._sensor(sensor_id)
        self._check_zone(data.zone_id)
        with self.transaction():
            self._apply(sensor, data)
        return self._out(sensor)

    def new_link(self, sensor_id: uuid.UUID) -> dict:
        """Replace the link, for one that got out. The old one stops working."""
        sensor = self._sensor(sensor_id)
        secret = secrets.token_urlsafe(24)
        with self.transaction():
            sensor.token_hash = _hash(secret)
        return {**self._out(sensor), "link": self._link(secret)}

    def delete_sensor(self, sensor_id: uuid.UUID) -> None:
        sensor = self._sensor(sensor_id)
        with self.transaction():
            self.db.delete(sensor)
