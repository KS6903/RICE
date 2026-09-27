"""Pydantic request schemas for the branches/company domain (Phase 3). Moved verbatim."""

import uuid

from pydantic import BaseModel


class BranchCreate(BaseModel):
    name: str
    address: str | None = None
    is_main_branch: bool = False


class BranchUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    is_active: bool | None = None


class CompanyUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    tin: str | None = None
    nfa_license_no: str | None = None
    da_registration_no: str | None = None
    phone: str | None = None
    email: str | None = None
    is_multi_branch: bool | None = None


class BulkDeleteIn(BaseModel):
    ids: list[uuid.UUID]


class SetupCompany(BaseModel):
    name: str
    tin: str | None = None
    nfa_license_no: str | None = None
    da_registration_no: str | None = None
    phone: str | None = None
    email: str | None = None
    is_multi_branch: bool = False


class SetupAdmin(BaseModel):
    username: str
    full_name: str
    email: str | None = None
    password: str


class SetupRequest(BaseModel):
    company: SetupCompany
    admin: SetupAdmin
