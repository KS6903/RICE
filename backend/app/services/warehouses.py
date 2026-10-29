"""Warehouses: the places a branch keeps its stock.

A branch always has at least one. The first is made with the branch, named
"Warehouse 1 - <branch name>"; the Boss can add more ("Warehouse 2 - …"). Stock
and purchases point at a warehouse as well as a branch, so the stock tables can
say where each lot sits. The helpers here are what every stock write uses to
find the warehouse: the one asked for, else the branch's first.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session

from ..core.exceptions import ConflictError, NotFoundError, ValidationError
from ..models.buying import ByproductPurchase, RicePurchase
from ..models.company import Branch
from ..models.milling import ByproductInventory, MilledRiceInventory
from ..models.paddy import PalayInventory, PalayPurchase
from ..models.warehouse import Warehouse
from ..services.activity import log_activity
from ..services.base import BaseService

# Every table that can point at a warehouse: once one does, the warehouse
# has a history and can't be deleted.
_USED_BY = (PalayInventory, MilledRiceInventory, ByproductInventory, PalayPurchase, RicePurchase, ByproductPurchase)


def warehouse_name(branch_name: str, number: int) -> str:
    return f"Warehouse {number} - {branch_name}"


def ensure_default_warehouse(db: Session, branch: Branch) -> Warehouse:
    """The branch's first warehouse, made now if it has none (a branch made
    before warehouses existed, or by a path that didn't make one)."""
    first = db.scalars(
        select(Warehouse)
        .where(Warehouse.branch_id == branch.id)
        .order_by(Warehouse.is_default.desc(), Warehouse.created_at, Warehouse.id)
    ).first()
    if first is not None:
        return first
    first = Warehouse(
        company_id=branch.company_id,
        branch_id=branch.id,
        name=warehouse_name(branch.name, 1),
        is_default=True,
    )
    db.add(first)
    db.flush()
    # Stock and purchases recorded before the branch had a warehouse (or loaded
    # from an older backup) belong to it.
    for model in _USED_BY:
        db.execute(
            update(model)
            .where(model.branch_id == branch.id, model.warehouse_id.is_(None))
            .values(warehouse_id=first.id)
        )
    return first


def rename_branch_warehouses(db: Session, branch: Branch, old_name: str) -> None:
    """A branch was renamed: its warehouses still named after it ("Warehouse 2 - <old
    name>") follow. One the Boss named by hand is left alone."""
    for w in db.scalars(select(Warehouse).where(Warehouse.branch_id == branch.id)):
        head, sep, tail = w.name.partition(" - ")
        if sep and tail == old_name and head.startswith("Warehouse ") and head[len("Warehouse ") :].isdigit():
            w.name = f"{head} - {branch.name}"


def warehouse_map(db: Session, company_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """Every warehouse of the company by id, for naming the stock rows."""
    rows = db.scalars(select(Warehouse).where(Warehouse.company_id == company_id)).all()
    return {str(w.id): {"id": str(w.id), "name": w.name, "branch_id": str(w.branch_id)} for w in rows}


def default_warehouse_id(db: Session, branch_id: uuid.UUID | None) -> uuid.UUID | None:
    """The warehouse stock goes into when nobody picks one (None for stock
    that has no branch)."""
    if branch_id is None:
        return None
    branch = db.get(Branch, branch_id)
    return ensure_default_warehouse(db, branch).id if branch is not None else None


def warehouse_for(
    db: Session, *, company_id: uuid.UUID, branch_id: uuid.UUID | None, warehouse_id: uuid.UUID | None
) -> uuid.UUID | None:
    """The warehouse to put stock in: the one asked for, which must be one of
    the company's and in that branch (another's reads as missing), else the
    branch's first."""
    if warehouse_id is None:
        return default_warehouse_id(db, branch_id)
    found = db.get(Warehouse, warehouse_id)
    if found is None or found.company_id != company_id or found.branch_id != branch_id:
        raise NotFoundError("Warehouse not found.")
    return found.id


def warehouse_ids_of(db: Session, branch_id: uuid.UUID | None) -> list[uuid.UUID]:
    """A branch's warehouses, its first first: the order milling takes stock from."""
    if branch_id is None:
        return []
    return list(
        db.scalars(
            select(Warehouse.id)
            .where(Warehouse.branch_id == branch_id)
            .order_by(Warehouse.is_default.desc(), Warehouse.created_at, Warehouse.id)
        )
    )


class WarehouseService(BaseService):
    def _branch(self, branch_id: uuid.UUID) -> Branch:
        branch = self.db.get(Branch, branch_id)
        if branch is None or branch.company_id != self.current_user.company_id or branch.deleted_at is not None:
            raise NotFoundError("Branch not found.")
        return branch

    def _own(self, warehouse_id: uuid.UUID) -> Warehouse:
        found = self.db.get(Warehouse, warehouse_id)
        if found is None or found.company_id != self.current_user.company_id:
            raise NotFoundError("Warehouse not found.")
        return found

    @staticmethod
    def _show(w: Warehouse) -> dict[str, Any]:
        return {"id": str(w.id), "branch_id": str(w.branch_id), "name": w.name, "is_default": w.is_default}

    def list(self, *, branch_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
        """Every live branch's warehouses (each branch's first made here if it
        has none yet), the main branch's first."""
        stmt = select(Branch).where(Branch.company_id == self.current_user.company_id, Branch.deleted_at.is_(None))
        if branch_id is not None:
            stmt = stmt.where(Branch.id == branch_id)
        branches = self.db.scalars(stmt).all()
        if any(
            self.db.scalars(select(Warehouse.id).where(Warehouse.branch_id == b.id)).first() is None for b in branches
        ):
            with self.transaction():
                for b in branches:
                    ensure_default_warehouse(self.db, b)
        rows = self.db.scalars(
            select(Warehouse)
            .where(
                Warehouse.company_id == self.current_user.company_id, Warehouse.branch_id.in_([b.id for b in branches])
            )
            .order_by(Warehouse.is_default.desc(), Warehouse.created_at, Warehouse.id)
        ).all()
        return [self._show(w) for w in rows]

    def add(self, branch_id: uuid.UUID, name: str | None) -> dict[str, Any]:
        """Another warehouse for a branch: "Warehouse <next number> - <branch>"
        unless given a name."""
        branch = self._branch(branch_id)
        with self.transaction():
            ensure_default_warehouse(self.db, branch)
            taken = {n for (n,) in self.db.execute(select(Warehouse.name).where(Warehouse.branch_id == branch.id))}
            chosen = (name or "").strip()
            if not chosen:
                number = len(taken) + 1
                while warehouse_name(branch.name, number) in taken:
                    number += 1
                chosen = warehouse_name(branch.name, number)
            elif chosen in taken:
                raise ConflictError("This branch already has a warehouse with that name.")
            w = Warehouse(company_id=branch.company_id, branch_id=branch.id, name=chosen, is_default=False)
            self.db.add(w)
            self.db.flush()
            log_activity(
                self.db,
                company_id=self.current_user.company_id,
                user_id=self.current_user.id,
                action="storage.add",
                entity_type="warehouse",
                entity_id=w.id,
                entity_label=w.name,
            )
        return self._show(w)

    def rename(self, warehouse_id: uuid.UUID, name: str) -> dict[str, Any]:
        w = self._own(warehouse_id)
        chosen = name.strip()
        if not chosen:
            raise ValidationError("Give the warehouse a name.")
        clash = self.db.scalars(
            select(Warehouse.id).where(
                Warehouse.branch_id == w.branch_id, Warehouse.name == chosen, Warehouse.id != w.id
            )
        ).first()
        if clash is not None:
            raise ConflictError("This branch already has a warehouse with that name.")
        with self.transaction():
            before = w.name
            w.name = chosen
            if before != chosen:
                log_activity(
                    self.db,
                    company_id=self.current_user.company_id,
                    user_id=self.current_user.id,
                    action="storage.rename",
                    entity_type="warehouse",
                    entity_id=w.id,
                    entity_label=chosen,
                    detail=f"{before} → {chosen}",
                )
        return self._show(w)

    def delete(self, warehouse_id: uuid.UUID) -> dict[str, Any]:
        """Delete a warehouse that never held anything. A branch keeps at least
        one; if its first goes, the next becomes the first."""
        w = self._own(warehouse_id)
        siblings = self.db.scalars(
            select(Warehouse)
            .where(Warehouse.branch_id == w.branch_id, Warehouse.id != w.id)
            .order_by(Warehouse.created_at, Warehouse.id)
        ).all()
        if not siblings:
            raise ConflictError("A branch must keep at least one warehouse.")
        if any(self.db.scalar(select(exists().where(m.warehouse_id == w.id))) for m in _USED_BY):
            raise ConflictError("This warehouse has stock or purchases recorded, so it can't be deleted.")
        with self.transaction():
            if w.is_default:
                siblings[0].is_default = True
            log_activity(
                self.db,
                company_id=self.current_user.company_id,
                user_id=self.current_user.id,
                action="storage.delete",
                entity_type="warehouse",
                entity_id=w.id,
                entity_label=w.name,
            )
            self.db.delete(w)
        return {"deleted": True, "id": str(warehouse_id)}
