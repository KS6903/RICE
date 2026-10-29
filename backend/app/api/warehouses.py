"""Warehouses HTTP controllers: the places inside a branch where stock is kept.

Anyone signed in may list them (the purchase forms and the Inventory page pick
from the list); adding, renaming and deleting are the Inventory page's write
power, the same as adding stock."""

import uuid

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..services.warehouses import WarehouseService

router = APIRouter()

INVENTORY_WRITE = [Depends(require_feature("inventory")), Depends(require_section_access("inventory", write=True))]


class WarehouseAdd(BaseModel):
    branch_id: uuid.UUID
    # Left out, it is named "Warehouse <next number> - <branch name>".
    name: str | None = Field(None, max_length=255)


class WarehouseRename(BaseModel):
    name: str = Field(max_length=255)


def get_warehouse_service(db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> WarehouseService:
    return WarehouseService(db, current_user)


@router.get("/")
def list_warehouses(branch_id: uuid.UUID | None = None, svc: WarehouseService = Depends(get_warehouse_service)):
    return svc.list(branch_id=branch_id)


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=INVENTORY_WRITE)
def add_warehouse(body: WarehouseAdd, svc: WarehouseService = Depends(get_warehouse_service)):
    return svc.add(body.branch_id, body.name)


@router.put("/{warehouse_id}", dependencies=INVENTORY_WRITE)
def rename_warehouse(
    warehouse_id: uuid.UUID, body: WarehouseRename, svc: WarehouseService = Depends(get_warehouse_service)
):
    return svc.rename(warehouse_id, body.name)


@router.delete("/{warehouse_id}", dependencies=INVENTORY_WRITE)
def delete_warehouse(warehouse_id: uuid.UUID, svc: WarehouseService = Depends(get_warehouse_service)):
    return svc.delete(warehouse_id)
