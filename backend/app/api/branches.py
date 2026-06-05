"""Branches/company HTTP controllers — thin routing over BranchService (Phase 3)."""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_roles
from ..schemas.branches import (
    BranchCreate,
    BranchUpdate,
    BulkDeleteIn,
    CompanyUpdate,
    SetupRequest,
)
from ..services.branch_service import BranchService

router = APIRouter()

WRITE_ROLES = ("owner", "admin")


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

@router.get("/company")
def get_company(svc: BranchService = Depends(get_branch_service)):
    return svc.get_company()


@router.put("/company", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def update_company(body: CompanyUpdate, svc: BranchService = Depends(get_branch_service)):
    return svc.update_company(body)


# ── Branches ────────────────────────────────────────────────────────────────

@router.get("/")
def list_branches(svc: BranchService = Depends(get_branch_service)):
    return svc.list_branches()


@router.post("/bulk-delete", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def bulk_delete_branches(body: BulkDeleteIn, svc: BranchService = Depends(get_branch_service)):
    return svc.bulk_delete(body.ids)


@router.get("/trash", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def list_trashed_branches(svc: BranchService = Depends(get_branch_service)):
    return svc.list_trashed()


@router.post("/{branch_id}/restore", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def restore_branch(branch_id: uuid.UUID, svc: BranchService = Depends(get_branch_service)):
    return svc.restore_branch(branch_id)


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(*WRITE_ROLES))])
def create_branch(body: BranchCreate, svc: BranchService = Depends(get_branch_service)):
    return svc.create_branch(body)


@router.put("/{branch_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def update_branch(branch_id: uuid.UUID, body: BranchUpdate, svc: BranchService = Depends(get_branch_service)):
    return svc.update_branch(branch_id, body)
