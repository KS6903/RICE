"""Saved-locations + geocoding HTTP controllers — thin routing over
LocationService (Phase 3).

Security posture (unchanged, now enforced in GeocodingClient): HTTPS-only,
hardcoded upstream host, strict query validation, per-user rate limiting,
defensive re-shaping. Every endpoint requires auth.
"""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_section_access
from ..repositories.locations import UserLocationRepository
from ..schemas.locations import LocationCreate
from ..services.location_service import LocationService

router = APIRouter(dependencies=[Depends(require_section_access("settings"))])


def get_location_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> LocationService:
    return LocationService(db, current_user, locations=UserLocationRepository(db))


@router.get("/locations")
def list_locations(svc: LocationService = Depends(get_location_service)):
    return svc.list_locations()


@router.post(
    "/locations",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("settings", write=True))],
)
def create_location(body: LocationCreate, svc: LocationService = Depends(get_location_service)):
    return svc.create_location(body)


@router.patch(
    "/locations/{location_id}/set-default",
    dependencies=[Depends(require_section_access("settings", write=True))],
)
def set_default(location_id: uuid.UUID, svc: LocationService = Depends(get_location_service)):
    return svc.set_default(location_id)


@router.delete(
    "/locations/{location_id}",
    status_code=204,
    dependencies=[Depends(require_section_access("settings", write=True))],
)
def delete_location(location_id: uuid.UUID, svc: LocationService = Depends(get_location_service)):
    svc.delete_location(location_id)


@router.get("/locations/search")
def search_places(
    q: str = Query(..., min_length=2, max_length=80, description="Place name"),
    svc: LocationService = Depends(get_location_service),
):
    """Hardened proxy to the Open-Meteo Geocoding API."""
    return svc.search_places(q)
