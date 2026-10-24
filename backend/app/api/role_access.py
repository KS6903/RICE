"""Role access HTTP controllers: which pages each role can open in this mill,
and the roles the Boss makes up.

Anyone who can see the Users page can read the matrix (it's where a role is
chosen for someone); only the Boss changes it.
"""

import uuid
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

Level = Literal["none", "view", "full"]
BOSS_ONLY = [Depends(require_roles("owner"))]


class RoleAccessUpdate(BaseModel):
    # The level on each page the Boss chose; a page left out goes back to its default.
    access: dict[str, Level]


class CustomRoleCreate(BaseModel):
    name: str
    # The level on each page; a page left out is closed.
    access: dict[str, Level]


class CustomRoleUpdate(BaseModel):
    name: str | None = None
    access: dict[str, Level] | None = None


def get_role_access_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> RoleAccessService:
    return RoleAccessService(db, current_user)


@router.get("/")
def get_role_access(svc: RoleAccessService = Depends(get_role_access_service)):
    return svc.get()


@router.post("/custom", status_code=201, dependencies=BOSS_ONLY)
def create_custom_role(body: CustomRoleCreate, svc: RoleAccessService = Depends(get_role_access_service)):
    return svc.create_custom(body.name, body.access)


@router.put("/custom/{role_id}", dependencies=BOSS_ONLY)
def update_custom_role(
    role_id: uuid.UUID,
    body: CustomRoleUpdate,
    svc: RoleAccessService = Depends(get_role_access_service),
):
    return svc.update_custom(role_id, body.name, body.access)


@router.delete("/custom/{role_id}", dependencies=BOSS_ONLY)
def delete_custom_role(role_id: uuid.UUID, svc: RoleAccessService = Depends(get_role_access_service)):
    return svc.delete_custom(role_id)


@router.put("/{role}", dependencies=BOSS_ONLY)
def set_role_access(
    role: str,
    body: RoleAccessUpdate,
    svc: RoleAccessService = Depends(get_role_access_service),
):
    return svc.set_role(role, body.access)
