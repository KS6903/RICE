"""BranchService — company + warehouse (branch) business logic (Phase 3).

Includes first-run setup, company read/update, branch CRUD with the multi-branch
402 gate, and the soft-delete trash/restore lifecycle. The shared audit helpers
(log_activity, purge_expired_branches) stay as functions in services/activity.py
and are enlisted in this service's transactions.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ..core.exceptions import AppException, ConflictError, FeatureRequiredError, NotFoundError
from ..core.security import get_user_features, hash_password
from ..models.base import now_utc
from ..models.company import Branch, Company
from ..models.subscription import Subscription
from ..models.user import Role, User
from ..repositories.branches import BranchRepository
from ..services.activity import TRASH_RETENTION_DAYS, log_activity, purge_expired_branches
from ..services.base import BaseService


class BranchService(BaseService):
    def __init__(self, db: Session, current_user: Any = None, *, branches: BranchRepository | None = None) -> None:
        super().__init__(db, current_user)
        self.branches = branches or BranchRepository(db)

    # ── first-run setup (unauthenticated) ─────────────────────────────────────

    def setup_status(self) -> dict:
        return {"configured": self.db.query(Company).first() is not None}

    def first_run_setup(self, data) -> dict:
        if self.db.query(Company).first():
            raise ConflictError("System already configured. Use the admin account to log in.")
        owner_role = self.db.query(Role).filter_by(name="owner").first()
        if not owner_role:
            # Pre-existing 500 semantics: surface a clear server-config error.
            raise AppException("Roles not seeded. Run seed.py first.")
        with self.transaction():
            company = Company(**data.company.model_dump())
            self.db.add(company)
            self.db.flush()
            branch = Branch(company_id=company.id, name=data.company.name, is_main_branch=True)
            self.db.add(branch)
            self.db.flush()
            self.db.add(
                User(
                    company_id=company.id,
                    branch_id=branch.id,
                    username=data.admin.username,
                    full_name=data.admin.full_name,
                    email=data.admin.email,
                    password_hash=hash_password(data.admin.password),
                    role_id=owner_role.id,
                )
            )
        return {"message": "Setup complete. You can now log in.", "company_id": str(company.id)}

    # ── company ───────────────────────────────────────────────────────────────

    def get_company(self) -> dict:
        company = self.db.get(Company, self.current_user.company_id)
        if not company:
            raise NotFoundError("Company not found")
        return {
            "id": str(company.id),
            "name": company.name,
            "address": company.address,
            "tin": company.tin,
            "nfa_license_no": company.nfa_license_no,
            "da_registration_no": company.da_registration_no,
            "phone": company.phone,
            "email": company.email,
            "currency": company.currency,
            "timezone": company.timezone,
            "is_multi_branch": company.is_multi_branch,
        }

    def update_company(self, data) -> dict:
        company = self.db.get(Company, self.current_user.company_id)
        if not company:
            raise NotFoundError("Company not found")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(company, field, val)
        return {"message": "Company updated"}

    # ── branches ──────────────────────────────────────────────────────────────

    def list_branches(self) -> Sequence[Branch]:
        return self.branches.list_live_for_company(self.current_user.company_id)

    def create_branch(self, data) -> Branch:
        company_id = self.current_user.company_id
        existing_count = self.branches.count_for_company(company_id)
        features = get_user_features(self.current_user, self.db)
        if existing_count >= 1 and "multi_branch" not in features:
            raise FeatureRequiredError(
                "Multi-branch is not included in your current plan. Please upgrade to add more branches.",
                code="multi_branch",
            )
        sub = self.db.query(Subscription).filter(Subscription.company_id == company_id).first()
        if sub and sub.plan and sub.plan.max_branches is not None and existing_count >= sub.plan.max_branches:
            raise FeatureRequiredError(
                f"Your plan allows up to {sub.plan.max_branches} branches. Please upgrade for more.",
                code="branch_limit",
            )
        branch = Branch(company_id=company_id, **data.model_dump())
        with self.transaction():
            self.branches.add(branch)
        self.db.refresh(branch)
        return branch

    def update_branch(self, branch_id: uuid.UUID, data) -> Branch:
        branch = self.branches.get_for_company(branch_id, self.current_user.company_id, include_deleted=True)
        if not branch:
            raise NotFoundError("Branch not found")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(branch, field, val)
        self.db.refresh(branch)
        return branch

    # ── soft-delete lifecycle ─────────────────────────────────────────────────

    def bulk_delete(self, ids: list[uuid.UUID]) -> dict:
        company_id = self.current_user.company_id
        live = self.branches.list_live_for_company(company_id)
        live_by_id = {b.id: b for b in live}
        live_count = len(live)

        deleted: list[str] = []
        skipped: list[dict] = []
        with self.transaction():
            for bid in ids:
                branch = live_by_id.get(bid)
                if not branch:
                    skipped.append({"id": str(bid), "reason": "Not found or already trashed."})
                    continue
                if branch.is_main_branch:
                    skipped.append({"id": str(bid), "reason": "The main warehouse can't be deleted."})
                    continue
                if live_count - len(deleted) <= 1:
                    skipped.append({"id": str(bid), "reason": "You must keep at least one warehouse."})
                    continue
                branch.deleted_at = now_utc()
                branch.deleted_by = self.current_user.id
                log_activity(
                    self.db,
                    company_id=company_id,
                    user_id=self.current_user.id,
                    action="warehouse.delete",
                    entity_type="branch",
                    entity_id=branch.id,
                    entity_label=branch.name,
                )
                deleted.append(str(bid))
        return {"deleted": deleted, "skipped": skipped}

    def list_trashed(self) -> list[dict]:
        company_id = self.current_user.company_id
        # Lazily purge anything past retention (commits its own work), then list.
        purge_expired_branches(self.db, company_id)
        rows = self.branches.list_trashed_for_company(company_id)

        deleter_ids = {b.deleted_by for b in rows if b.deleted_by}
        names: dict[uuid.UUID, str] = {}
        if deleter_ids:
            for u in self.db.query(User).filter(User.id.in_(deleter_ids)).all():
                names[u.id] = u.full_name or u.username

        out = []
        for b in rows:
            deleted_at = b.deleted_at
            if deleted_at is None:  # rows are trashed, but narrow for the type-checker
                continue
            expires_at = deleted_at + timedelta(days=TRASH_RETENTION_DAYS)
            days_remaining = max(0, (expires_at - now_utc()).days)
            out.append(
                {
                    "id": str(b.id),
                    "name": b.name,
                    "is_main_branch": b.is_main_branch,
                    "deleted_at": deleted_at.isoformat(),
                    "deleted_by_name": names.get(b.deleted_by) if b.deleted_by else None,
                    "days_remaining": days_remaining,
                }
            )
        return out

    def restore_branch(self, branch_id: uuid.UUID) -> dict:
        branch = self.branches.get_for_company(branch_id, self.current_user.company_id, include_deleted=True)
        if not branch:
            raise NotFoundError("Branch not found")
        if branch.deleted_at is None:
            raise ConflictError("This warehouse is not in the trash.")
        with self.transaction():
            branch.deleted_at = None
            branch.deleted_by = None
            log_activity(
                self.db,
                company_id=self.current_user.company_id,
                user_id=self.current_user.id,
                action="warehouse.restore",
                entity_type="branch",
                entity_id=branch.id,
                entity_label=branch.name,
            )
        return {"restored": True, "id": str(branch.id)}
