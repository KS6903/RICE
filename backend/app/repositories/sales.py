"""Repositories for the sales domain (Phase 3)."""
from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.sales import Invoice, PriceList, SalesOrder
from ..models.supplier_customer import Customer
from .base import BaseRepository


class CustomerRepository(BaseRepository[Customer]):
    model = Customer

    def list_for_company(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[Customer]:
        stmt = select(Customer).where(Customer.company_id == company_id)
        if not include_inactive:
            stmt = stmt.where(Customer.is_active.is_(True))
        return self.db.execute(stmt.order_by(Customer.name)).scalars().all()


class PriceListRepository(BaseRepository[PriceList]):
    model = PriceList

    def list_active_for_company(self, company_id: uuid.UUID) -> Sequence[PriceList]:
        stmt = select(PriceList).where(
            PriceList.company_id == company_id, PriceList.is_active.is_(True)
        )
        return self.db.execute(stmt).scalars().all()


class SalesOrderRepository(BaseRepository[SalesOrder]):
    model = SalesOrder

    def list_for_company(
        self, company_id: uuid.UUID, *, status: str | None = None, skip: int = 0, limit: int = 50
    ) -> Sequence[SalesOrder]:
        stmt = select(SalesOrder).where(SalesOrder.company_id == company_id)
        if status:
            stmt = stmt.where(SalesOrder.status == status)
        stmt = stmt.order_by(SalesOrder.order_date.desc()).offset(skip).limit(limit)
        return self.db.execute(stmt).scalars().all()

    def count(self) -> int:
        return self.db.query(SalesOrder).count()


class InvoiceRepository(BaseRepository[Invoice]):
    model = Invoice

    def list_for_company(self, company_id: uuid.UUID, *, status: str | None = None) -> Sequence[Invoice]:
        stmt = select(Invoice).where(Invoice.company_id == company_id)
        if status:
            stmt = stmt.where(Invoice.status == status)
        return self.db.execute(stmt.order_by(Invoice.invoice_date.desc())).scalars().all()

    def count(self) -> int:
        return self.db.query(Invoice).count()
