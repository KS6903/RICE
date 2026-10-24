"""The by-products a mill handles (services/byproduct_kind_service.py).

Anyone in the mill reads the list, since buying, stock and sales all pick from
it; changing it is for whoever can edit the Buy & mill pages, as with rice
varieties.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..schemas.byproduct_kinds import ByproductKindCreate, ByproductKindUpdate
from ..services.byproduct_kind_service import ByproductKindService

router = APIRouter()

EDITOR = [Depends(require_feature("paddy")), Depends(require_section_access("paddy", write=True))]


def get_service(db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> ByproductKindService:
    return ByproductKindService(db, current_user)


@router.get("/")
def list_byproduct_kinds(include_hidden: bool = False, svc: ByproductKindService = Depends(get_service)):
    return svc.list_kinds(include_hidden=include_hidden)


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=EDITOR)
def create_byproduct_kind(body: ByproductKindCreate, svc: ByproductKindService = Depends(get_service)):
    return svc.create(body.name)


@router.patch("/{kind_id}", dependencies=EDITOR)
def update_byproduct_kind(
    kind_id: uuid.UUID, body: ByproductKindUpdate, svc: ByproductKindService = Depends(get_service)
):
    return svc.update(kind_id, name=body.name, is_active=body.is_active)
