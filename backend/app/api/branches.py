"""Branches/company HTTP controllers — thin routing over BranchService (Phase 3)."""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_section_access
from ..schemas.branches import (
    BranchCreate,
    BranchUpdate,
    BulkDeleteIn,
    CompanyUpdate,
    SetupRequest,
)
from ..services.branch_service import BranchService

router = APIRouter()

# Changing the company and its branches is the mill's settings, for whoever the
# Boss opened Settings to with edit (core/access_policy.py).
SETTINGS_WRITE = [Depends(require_section_access("settings", write=True))]


def get_branch_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> BranchService:
    return BranchService(db, current_user)


def get_setup_service(db: Session = Depends(get_db)) -> BranchService:
    """Unauthenticated service for the first-run setup endpoints."""
    return BranchService(db)


# ── First-run setup (no auth) ───────────────────────────────────────────────


@router.get("/setup-status")
def setup_status(svc: BranchService = Depends(get_setup_service)):
    return svc.setup_status()


@router.post("/setup", status_code=status.HTTP_201_CREATED)
def first_run_setup(body: SetupRequest, svc: BranchService = Depends(get_setup_service)):
    return svc.first_run_setup(body)


# ── Company ─────────────────────────────────────────────────────────────────


# Anyone signed in: the mill's name and details head invoices and reports.
@router.get("/company")
def get_company(svc: BranchService = Depends(get_branch_service)):
    return svc.get_company()


@router.put("/company", dependencies=SETTINGS_WRITE)
def update_company(body: CompanyUpdate, svc: BranchService = Depends(get_branch_service)):
    return svc.update_company(body)


# ── Branches ────────────────────────────────────────────────────────────────


# Anyone signed in: every page that picks a warehouse or branch needs the list.
@router.get("/")
def list_branches(svc: BranchService = Depends(get_branch_service)):
    return svc.list_branches()


@router.post("/bulk-delete", dependencies=SETTINGS_WRITE)
def bulk_delete_branches(body: BulkDeleteIn, svc: BranchService = Depends(get_branch_service)):
    return svc.bulk_delete(body.ids)


@router.get("/trash", dependencies=[Depends(require_section_access("settings"))])
def list_trashed_branches(svc: BranchService = Depends(get_branch_service)):
    return svc.list_trashed()


@router.post("/{branch_id}/restore", dependencies=SETTINGS_WRITE)
def restore_branch(branch_id: uuid.UUID, svc: BranchService = Depends(get_branch_service)):
    return svc.restore_branch(branch_id)


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=SETTINGS_WRITE)
def create_branch(body: BranchCreate, svc: BranchService = Depends(get_branch_service)):
    return svc.create_branch(body)


@router.put("/{branch_id}", dependencies=SETTINGS_WRITE)
def update_branch(branch_id: uuid.UUID, body: BranchUpdate, svc: BranchService = Depends(get_branch_service)):
    return svc.update_branch(branch_id, body)
