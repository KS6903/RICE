"""Role access HTTP controllers: which pages each role can open in this mill.

Anyone who can see the Users page can read the matrix; only the Boss changes it.
"""

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles, require_section_access
from ..services.role_access_service import RoleAccessService

router = APIRouter(
    dependencies=[
        Depends(require_feature("users")),
        Depends(require_section_access("users")),
    ]
)


class RoleAccessUpdate(BaseModel):
    # The level on each page the Boss chose; a page left out goes back to its default.
    access: dict[str, Literal["none", "view", "full"]]


def get_role_access_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> RoleAccessService:
    return RoleAccessService(db, current_user)


@router.get("/")
def get_role_access(svc: RoleAccessService = Depends(get_role_access_service)):
    return svc.get()


@router.put("/{role}", dependencies=[Depends(require_roles("owner"))])
def set_role_access(
    role: str,
    body: RoleAccessUpdate,
    svc: RoleAccessService = Depends(get_role_access_service),
):
    return svc.set_role(role, body.access)
