"""Where the Boss's branch picker opens (core/branch_scope.py)."""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.exceptions import NotFoundError
from ..core.security import get_current_user, require_roles
from ..models.company import Branch

router = APIRouter(dependencies=[Depends(require_roles("owner", "admin"))])


class BranchViewIn(BaseModel):
    # "main", "all", or a branch id.
    view: str


@router.put("")
def set_branch_view(body: BranchViewIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Make this view the one the picker opens on, on every device."""
    view = body.view
    if view not in ("main", "all"):
        try:
            branch = db.get(Branch, uuid.UUID(view))
        except ValueError:
            branch = None
        if branch is None or branch.company_id != current_user.company_id or branch.deleted_at is not None:
            raise NotFoundError("Branch not found")
        view = str(branch.id)
    current_user.default_branch_view = None if view == "main" else view
    db.commit()
    return {"branch_view_default": view}
