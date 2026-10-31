"""Security boundary for tenant offline-sync push/pull operations."""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, FrozenSet, Mapping, Sequence

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.access_policy import company_overrides, section_level
from ..core.security import SECTION_ACCESS
from ..models.company import Branch
from ..models.sync import SyncConflict, SyncLog
from ..models.user import User
from ..repositories.sync import SyncConflictRepository, SyncLogRepository
from ..schemas.sync import ConflictResolutionValue, JsonScalar, SyncRecord
from ..services import stock_ledger
from ..services.base import BaseService

logger = logging.getLogger("ricemill.sync")

ALL_SYNC_ROLES: FrozenSet[str] = frozenset(SECTION_ACCESS)
MANAGE_ROLES: FrozenSet[str] = frozenset({"owner", "admin"})

# Marks a refusal of one record, as opposed to of the account or the session:
# the desktop app splits the batch to find that record, sets it aside, and
# syncs the rest (packages/desktop/main/sync/push.ts). An unmarked 403 means
# "stop": nothing in the batch would fare better on its own.
REJECTION_HEADER = "X-Sync-Rejection"


class SectionRoles(frozenset):
    """The roles that have a kind of access to one page by default, remembering
    which page and which kind: a mill's Boss may have changed who has it
    (core/access_policy.py), so the roles named here are only the default and
    ``SyncService._allowed`` settles it by the mill's own matrix."""

    section: str
    write: bool


def _section_roles(section: str, *, write: bool) -> SectionRoles:
    roles = SectionRoles(
        role
        for role, access in SECTION_ACCESS.items()
        if (access.get(section) == "full" if write else access.get(section) in {"view", "full"})
    )
    roles.section = section
    roles.write = write
    return roles


PADDY_READ = _section_roles("paddy", write=False)
PADDY_WRITE = _section_roles("paddy", write=True)
MILLING_READ = _section_roles("milling", write=False)
MILLING_WRITE = _section_roles("milling", write=True)
INVENTORY_READ = _section_roles("inventory", write=False)
INVENTORY_WRITE = _section_roles("inventory", write=True)
SALES_READ = _section_roles("sales", write=False)
SALES_WRITE = _section_roles("sales", write=True)
EXPENSE_READ = _section_roles("expenses", write=False)
EXPENSE_WRITE = _section_roles("expenses", write=True)

MAX_RECORD_BYTES = 32 * 1024
MAX_REQUEST_BYTES = 512 * 1024
PULL_PAGE_SIZE = 500


@dataclass(frozen=True)
class TablePolicy:
    allowed_keys: FrozenSet[str]
    required_insert_keys: FrozenSet[str]
    read_roles: FrozenSet[str]
    write_roles: FrozenSet[str]
    company_owned: bool = False
    branch_owned: bool = False
    force_user_keys: FrozenSet[str] = frozenset()
    user_reference_keys: FrozenSet[str] = frozenset()


def _keys(value: str) -> FrozenSet[str]:
    return frozenset(value.split())


TABLE_POLICIES: Mapping[str, TablePolicy] = {
    "palay_purchases": TablePolicy(
        _keys(
            "id company_id branch_id reference_no supplier_id purchase_date delivery_type status remarks created_by created_at updated_at"
        ),
        _keys("reference_no purchase_date"),
        PADDY_READ,
        PADDY_WRITE,
        company_owned=True,
        branch_owned=True,
        force_user_keys=_keys("created_by"),
    ),
    "palay_purchase_items": TablePolicy(
        _keys(
            "id purchase_id variety_id grade_id gross_weight_kg tare_weight_kg cavan_count moisture_content_pct price_per_cavan"
        ),
        _keys("purchase_id gross_weight_kg price_per_cavan"),
        PADDY_READ,
        PADDY_WRITE,
    ),
    "palay_inventory": TablePolicy(
        _keys("id company_id branch_id variety_id grade_id quantity_kg updated_at"),
        frozenset(),
        INVENTORY_READ,
        INVENTORY_WRITE,
        company_owned=True,
        branch_owned=True,
    ),
    "milling_batches": TablePolicy(
        _keys(
            "id company_id branch_id batch_no equipment_id operator_id customer_id client_arrangement client_notes start_datetime end_datetime status remarks created_by created_at updated_at"
        ),
        _keys("batch_no start_datetime"),
        MILLING_READ,
        MILLING_WRITE,
        company_owned=True,
        branch_owned=True,
        force_user_keys=_keys("created_by"),
        user_reference_keys=_keys("operator_id"),
    ),
    "milling_batch_inputs": TablePolicy(
        _keys("id batch_id variety_id grade_id input_weight_kg moisture_content_pct"),
        _keys("batch_id input_weight_kg"),
        MILLING_READ,
        MILLING_WRITE,
    ),
    "milling_batch_outputs": TablePolicy(
        _keys("id batch_id output_type variety_id output_weight_kg broken_rice_pct milling_recovery_pct"),
        _keys("batch_id output_type output_weight_kg"),
        MILLING_READ,
        MILLING_WRITE,
    ),
    "milled_rice_inventory": TablePolicy(
        _keys("id company_id branch_id variety_id grade_name quantity_kg updated_at"),
        frozenset(),
        INVENTORY_READ,
        INVENTORY_WRITE,
        company_owned=True,
        branch_owned=True,
    ),
    "byproduct_inventory": TablePolicy(
        _keys("id company_id branch_id byproduct_type quantity_kg updated_at"),
        _keys("byproduct_type"),
        INVENTORY_READ,
        INVENTORY_WRITE,
        company_owned=True,
        branch_owned=True,
    ),
    "sales_orders": TablePolicy(
        _keys(
            "id company_id branch_id order_no customer_id order_date delivery_date status discount_pct discount_amount subtotal total_amount remarks created_by created_at updated_at"
        ),
        _keys("order_no order_date"),
        SALES_READ,
        SALES_WRITE,
        company_owned=True,
        branch_owned=True,
        force_user_keys=_keys("created_by"),
    ),
    "sales_order_items": TablePolicy(
        _keys("id order_id item_type variety_id grade_name byproduct_type quantity_kg unit_price_per_kg"),
        _keys("order_id item_type quantity_kg unit_price_per_kg"),
        SALES_READ,
        SALES_WRITE,
    ),
    "invoices": TablePolicy(
        _keys(
            "id company_id branch_id invoice_no order_id customer_id invoice_date due_date total_amount paid_amount status created_by created_at updated_at"
        ),
        _keys("invoice_no invoice_date total_amount"),
        SALES_READ,
        SALES_WRITE,
        company_owned=True,
        branch_owned=True,
        force_user_keys=_keys("created_by"),
    ),
    "payments": TablePolicy(
        _keys("id invoice_id payment_date amount method reference_no received_by notes created_at"),
        _keys("payment_date amount method"),
        SALES_READ,
        SALES_WRITE,
        force_user_keys=_keys("received_by"),
    ),
    "expenses": TablePolicy(
        _keys(
            "id company_id branch_id category_id batch_id expense_date amount description reference_no approved_by created_by created_at updated_at"
        ),
        _keys("expense_date amount"),
        EXPENSE_READ,
        EXPENSE_WRITE,
        company_owned=True,
        branch_owned=True,
        force_user_keys=_keys("created_by"),
        user_reference_keys=_keys("approved_by"),
    ),
}


class SyncService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        logs: SyncLogRepository,
        conflicts: SyncConflictRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.logs = logs
        self.conflicts = conflicts

    def _role(self) -> str:
        role = getattr(getattr(self.current_user, "role", None), "name", None)
        if role not in ALL_SYNC_ROLES or not getattr(self.current_user, "company_id", None):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Offline sync is not available for this account"
            )
        return role

    def _allowed(self, role: str, roles: FrozenSet[str]) -> bool:
        """Whether ``role`` is among a table's roles. When they are a page's
        access, that is settled by this mill's matrix, which its Boss may have
        changed (a page opened to a role, or shut to it); otherwise by the list."""
        section = getattr(roles, "section", None)
        if section is None:
            return role in roles
        level = section_level(role, section, company_overrides(self.current_user))
        return level == "full" if getattr(roles, "write", False) else level in {"view", "full"}

    @staticmethod
    def _reject(status_code: int, detail: str) -> HTTPException:
        """A refusal of this one record (see REJECTION_HEADER)."""
        return HTTPException(status_code=status_code, detail=detail, headers={REJECTION_HEADER: "record"})

    @classmethod
    def _unprocessable(cls, detail: str) -> HTTPException:
        return cls._reject(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)

    def _assert_company(self, payload: dict[str, JsonScalar]) -> None:
        expected = str(self.current_user.company_id)
        supplied = payload.get("company_id")
        if supplied is not None and str(supplied) != expected:
            raise self._reject(status.HTTP_403_FORBIDDEN, "Sync record belongs to another company")
        payload["company_id"] = expected

    def _bind_branch(self, payload: dict[str, JsonScalar], role: str) -> None:
        supplied = payload.get("branch_id")
        selected = (
            str(supplied)
            if supplied is not None
            else (str(self.current_user.branch_id) if self.current_user.branch_id else None)
        )
        if not selected:
            raise self._unprocessable("A tenant branch is required for this sync table")
        try:
            branch_id = uuid.UUID(selected)
        except (TypeError, ValueError):
            raise self._unprocessable("Invalid branch_id")
        branch = self.db.get(Branch, branch_id)
        if (
            branch is None
            or branch.company_id != self.current_user.company_id
            or not branch.is_active
            or branch.deleted_at is not None
        ):
            raise self._reject(status.HTTP_403_FORBIDDEN, "Sync branch does not belong to this company")
        if role not in MANAGE_ROLES and branch.id != self.current_user.branch_id:
            raise self._reject(status.HTTP_403_FORBIDDEN, "Sync is limited to your assigned branch")
        payload["branch_id"] = str(branch.id)

    def _bind_user_fields(self, payload: dict[str, JsonScalar], policy: TablePolicy) -> None:
        expected = str(self.current_user.id)
        for key in policy.force_user_keys:
            supplied = payload.get(key)
            if supplied is not None and str(supplied) != expected:
                raise self._reject(status.HTTP_403_FORBIDDEN, f"{key} cannot identify another user")
            payload[key] = expected

        for key in policy.user_reference_keys:
            supplied = payload.get(key)
            if supplied is None:
                continue
            try:
                user_id = uuid.UUID(str(supplied))
            except (TypeError, ValueError):
                raise self._unprocessable(f"Invalid {key}")
            user = self.db.get(User, user_id)
            if user is None or user.company_id != self.current_user.company_id or not user.is_active:
                raise self._reject(status.HTTP_403_FORBIDDEN, f"{key} is not an active company user")
            payload[key] = str(user.id)

    def _sanitize_record(self, record: SyncRecord, role: str) -> dict[str, JsonScalar]:
        policy = TABLE_POLICIES[record.table_name]
        if not self._allowed(role, policy.write_roles):
            raise self._reject(
                status.HTTP_403_FORBIDDEN, f"Role '{role}' cannot write offline records for {record.table_name}"
            )
        if record.updated_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise self._unprocessable("updated_at cannot be more than five minutes in the future")

        payload = dict(record.payload)
        unknown = set(payload) - policy.allowed_keys
        if unknown:
            names = ", ".join(sorted(unknown))
            raise self._unprocessable(f"Unsupported payload fields for {record.table_name}: {names}")

        record_id = str(record.record_id)
        supplied_id = payload.get("id")
        if supplied_id is not None and str(supplied_id) != record_id:
            raise self._unprocessable("payload.id must match record_id")

        if record.operation == "DELETE":
            if set(payload) - {"id"}:
                raise self._unprocessable("DELETE sync records must not contain a row payload")
            return {}

        payload["id"] = record_id
        if policy.company_owned:
            self._assert_company(payload)
        if policy.branch_owned:
            self._bind_branch(payload, role)
        self._bind_user_fields(payload, policy)

        if record.operation == "INSERT":
            missing = policy.required_insert_keys - {key for key, value in payload.items() if value is not None}
            if missing:
                names = ", ".join(sorted(missing))
                raise self._unprocessable(f"Missing INSERT fields for {record.table_name}: {names}")

        try:
            encoded = json.dumps(payload, allow_nan=False, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        except (TypeError, ValueError):
            raise self._unprocessable("Sync payload must contain finite JSON scalar values")
        if len(encoded) > MAX_RECORD_BYTES:
            raise self._reject(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Sync record payload is too large")
        return payload

    def push(self, client_id: str, records: Sequence[SyncRecord]) -> dict:
        role = self._role()
        seen: set[tuple[str, uuid.UUID]] = set()
        sanitized: list[tuple[SyncRecord, dict[str, JsonScalar]]] = []
        total_bytes = 0

        # Validate the complete batch before opening the transaction. A bad tail
        # record can therefore never leave a partially published prefix.
        for record in records:
            key = (record.table_name, record.record_id)
            if key in seen:
                raise self._unprocessable("A sync batch cannot contain the same table/record twice")
            seen.add(key)
            payload = self._sanitize_record(record, role)
            total_bytes += len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
            if total_bytes > MAX_REQUEST_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Sync batch is too large"
                )
            sanitized.append((record, payload))

        base_time = datetime.now(timezone.utc)
        with self.transaction():
            for offset, (record, payload) in enumerate(sanitized):
                self.db.add(
                    SyncLog(
                        company_id=self.current_user.company_id,
                        table_name=record.table_name,
                        record_id=record.record_id,
                        operation=record.operation,
                        payload=payload,
                        client_id=client_id,
                        # Unique ordered timestamps keep the legacy `since`
                        # cursor lossless within a batch.
                        synced_at=base_time + timedelta(microseconds=offset),
                    )
                )
            for_review = self._check_offline_orders(sanitized)
            self._post_offline_stock(sanitized)
        return {"synced": len(sanitized), "conflicts": 0, "for_review": for_review}

    def _post_offline_stock(self, sanitized: Sequence[tuple[SyncRecord, dict[str, JsonScalar]]]) -> None:
        """Sales made offline take their goods when they sync, and give them back if the
        order was cancelled. A line that can't be posted is logged and doesn't stop the
        sync: it's only a stock figure, and the sale itself is safe in the log."""
        user = self.current_user
        for record, payload in sanitized:
            try:
                with self.db.begin_nested():
                    if record.table_name == "sales_order_items" and record.operation == "INSERT":
                        stock_ledger.post_offline_item(
                            self.db, user, user.company_id, user.branch_id, record.record_id, dict(payload)
                        )
                    elif (
                        record.table_name == "sales_orders"
                        and record.operation == "UPDATE"
                        and payload.get("status") == "cancelled"
                    ):
                        stock_ledger.unpost_offline_order(self.db, user, uuid.UUID(str(record.record_id)))
            except Exception:
                logger.exception("offline sale stock failed", extra={"record_id": str(record.record_id)})

    def _check_offline_orders(self, sanitized: Sequence[tuple[SyncRecord, dict[str, JsonScalar]]]) -> int:
        """New orders taken offline go past the credit-limit guard; send the ones
        over a customer's limit to be reviewed. A problem here never holds up
        the sync: each check runs in its own savepoint. Returns how many went."""
        from ..automations import credit

        orders = [(r, p) for r, p in sanitized if r.table_name == "sales_orders" and r.operation == "INSERT"]
        if not orders:
            return 0
        company = self.current_user.company
        flagged = 0
        for record, payload in orders:
            try:
                with self.db.begin_nested():
                    flagged += credit.check_offline(self.db, company, self.current_user, record.record_id, payload)
            except Exception:
                logger.exception("offline order credit check failed", extra={"record_id": str(record.record_id)})
        return flagged

    def pull(self, since: datetime) -> dict:
        role = self._role()
        readable_tables = tuple(
            name for name, policy in TABLE_POLICIES.items() if self._allowed(role, policy.read_roles)
        )
        watermark = datetime.now(timezone.utc)
        logs = list(
            self.logs.pull_since(
                self.current_user.company_id,
                since,
                until=watermark,
                tables=readable_tables,
                limit=PULL_PAGE_SIZE + 1,
            )
        )
        has_more = len(logs) > PULL_PAGE_SIZE
        page = logs[:PULL_PAGE_SIZE]
        cursor = page[-1].synced_at if has_more and page else watermark
        return {
            "records": [
                {
                    "table_name": log.table_name,
                    "record_id": str(log.record_id),
                    "operation": log.operation,
                    "payload": log.payload or {},
                    "synced_at": log.synced_at.isoformat(),
                }
                for log in page
            ],
            "server_time": cursor.isoformat(),
            "has_more": has_more,
        }

    def list_conflicts(self) -> Sequence[SyncConflict]:
        if self._role() not in MANAGE_ROLES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return self.conflicts.list_unresolved(self.current_user.company_id)

    def resolve_conflict(self, conflict_id: uuid.UUID, resolution: ConflictResolutionValue) -> dict:
        if self._role() not in MANAGE_ROLES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        with self.transaction():
            conflict = self.db.execute(
                select(SyncConflict)
                .where(
                    SyncConflict.id == conflict_id,
                    SyncConflict.company_id == self.current_user.company_id,
                    SyncConflict.resolved_at.is_(None),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if conflict is None:
                return {"resolved": False}
            conflict.resolved_at = datetime.now(timezone.utc)
            conflict.resolved_by = self.current_user.id
            conflict.resolution = resolution
        return {"resolved": True}
