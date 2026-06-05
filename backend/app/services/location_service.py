"""LocationService — saved-locations business logic (Phase 3).

CRUD with the "first location becomes default", dedupe-on-label, and
"promote a sibling when the default is deleted" rules preserved verbatim.
Geocoding search is delegated to GeocodingClient.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError
from ..models.user_location import UserLocation
from ..repositories.locations import UserLocationRepository
from ..services.base import BaseService
from ..services.geocoding import GeocodingClient


class LocationService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        locations: UserLocationRepository,
        geocoder: GeocodingClient | None = None,
    ) -> None:
        super().__init__(db, current_user)
        self.locations = locations
        self.geocoder = geocoder or GeocodingClient()

    @staticmethod
    def _serialize(loc: UserLocation) -> dict[str, Any]:
        return {
            "id": str(loc.id),
            "label": loc.label,
            "lat": float(loc.lat),
            "lon": float(loc.lon),
            "country": loc.country,
            "region": loc.region,
            "is_default": loc.is_default,
            "created_at": loc.created_at.isoformat() if loc.created_at else None,
        }

    def list_locations(self) -> list[dict]:
        return [self._serialize(r) for r in self.locations.list_for_user(self.current_user.id)]

    def create_location(self, data) -> dict:
        label = data.label.strip()
        # Dedupe on (user, label) — return the existing row instead of erroring so
        # the UI can re-add a search result without an error path.
        existing = self.locations.find_by_label(self.current_user.id, label)
        if existing:
            return self._serialize(existing)

        # First location auto-becomes the default.
        should_default = data.is_default or not self.locations.has_any(self.current_user.id)
        loc = UserLocation(
            user_id=self.current_user.id,
            label=label,
            lat=Decimal(str(round(data.lat, 4))),
            lon=Decimal(str(round(data.lon, 4))),
            country=data.country,
            region=data.region,
            is_default=should_default,
        )
        with self.transaction():
            if should_default:
                self.locations.clear_defaults(self.current_user.id)
            self.locations.add(loc)
        self.db.refresh(loc)
        return self._serialize(loc)

    def set_default(self, location_id: uuid.UUID) -> dict:
        loc = self.locations.get_for_user(location_id, self.current_user.id)
        if not loc:
            raise NotFoundError("Location not found")
        with self.transaction():
            self.locations.clear_defaults(self.current_user.id, except_id=loc.id)
            loc.is_default = True
        self.db.refresh(loc)
        return self._serialize(loc)

    def delete_location(self, location_id: uuid.UUID) -> None:
        loc = self.locations.get_for_user(location_id, self.current_user.id)
        if not loc:
            raise NotFoundError("Location not found")
        was_default = loc.is_default
        with self.transaction():
            self.db.delete(loc)
            self.db.flush()
            if was_default:
                sibling = self.locations.oldest_for_user(self.current_user.id)
                if sibling:
                    sibling.is_default = True

    def search_places(self, q: str) -> list[dict]:
        return self.geocoder.search(q, self.current_user.id)
