"""Strict request contracts for the offline-sync API.

Sync records are replayed by every desktop client in a tenant, so accepting an
arbitrary table name, operation, or nested payload would turn this endpoint into
a tenant-wide data-corruption primitive.  Keep this allow-list in lockstep with
``packages/desktop/main/sync/contract.ts``.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

SyncTable = Literal[
    "palay_purchases",
    "palay_purchase_items",
    "palay_inventory",
    "milling_batches",
    "milling_batch_inputs",
    "milling_batch_outputs",
    "milled_rice_inventory",
    "byproduct_inventory",
    "sales_orders",
    "sales_order_items",
    "invoices",
    "payments",
    "expenses",
]
SyncOperation = Literal["INSERT", "UPDATE", "DELETE"]
ConflictResolutionValue = Literal["keep_local", "keep_remote", "merged"]

# SQLite rows must be flat scalar objects.  In particular, nested JSON is never
# converted into a SQL identifier/value by the desktop replay engine.
JsonScalar = str | int | float | bool | None


class SyncRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    table_name: SyncTable
    record_id: uuid.UUID
    operation: SyncOperation
    payload: dict[str, JsonScalar] = Field(default_factory=dict, max_length=48)
    updated_at: AwareDatetime

    @field_validator("payload")
    @classmethod
    def payload_keys_are_bounded(cls, value: dict[str, JsonScalar]) -> dict[str, JsonScalar]:
        for key, item in value.items():
            if not key or len(key) > 64:
                raise ValueError("payload keys must be between 1 and 64 characters")
            if isinstance(item, str) and len(item) > 8_000:
                raise ValueError(f"payload value for '{key}' is too long")
        return value


class SyncPushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: Annotated[
        str,
        Field(
            min_length=8,
            max_length=64,
            pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        ),
    ]
    records: list[SyncRecord] = Field(min_length=1, max_length=100)


class ConflictResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolution: ConflictResolutionValue
