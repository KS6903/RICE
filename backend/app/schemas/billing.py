"""Pydantic request schema for tenant billing (Phase 3). Moved verbatim."""

import uuid

from pydantic import BaseModel, Field


class _Proof(BaseModel):
    """The Boss's own password, and an authenticator code when they use
    two-factor: asked again before anything that changes the plan."""

    current_password: str | None = Field(None, max_length=72)
    mfa_code: str | None = Field(None, max_length=12)


class UpgradeRequestCreate(_Proof):
    plan_id: uuid.UUID
    note: str | None = Field(None, max_length=500)
    # A bank transfer: the reference on the receipt, and where it was sent from.
    reference: str | None = Field(None, max_length=100)
    paid_from: str | None = Field(None, max_length=100)
    request_type: str = "upgrade"  # "upgrade" or "change"
    billing_interval: str = "monthly"  # "monthly" or "annual"
    voucher_code: str | None = Field(None, max_length=60)


class CheckoutCreate(_Proof):
    plan_id: uuid.UUID
    billing_interval: str = "monthly"  # "monthly" or "annual"
    provider: str  # "paymongo" (pesos) or "paypal" (US dollars)
    voucher_code: str | None = Field(None, max_length=60)


class VoucherCheck(BaseModel):
    code: str = Field(max_length=60)
    plan_id: uuid.UUID | None = None
    billing_interval: str = "monthly"


class VoucherRedeem(_Proof):
    code: str = Field(max_length=60)
