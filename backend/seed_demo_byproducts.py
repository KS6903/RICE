"""By-products of the mill's own for each test mill, so Stock > Catalog's
By-products tab shows some beside ipa, darak and binlid: carbonized rice hull
and first-class bran to buy and sell, and rice straw, hidden from the pickers.

Added through ByproductKindService as the mill's owner, as the Catalog adds
them. Idempotent: one the mill already has (by name or code) is left as it is.

Run AFTER `alembic upgrade head` and `migrate_all_tenants.py`.

Usage, from backend/: python seed_demo.py --only byproducts [--all]
"""

from __future__ import annotations

from app.core.exceptions import ConflictError
from app.core.tenancy import set_search_path
from app.models.user import User
from app.services.byproduct_kind_service import ByproductKindService

# (name, shown in the pickers)
KINDS = [("Carbonized rice hull", True), ("Darak D1", True), ("Rice straw", False)]


def seed(db, username: str) -> str:
    """Add one test mill's own by-products; say what happened."""
    user = db.query(User).filter(User.username == username, User.company_id.is_not(None)).first()
    if not user:
        return f"{username}: not found or has no company — skipped"
    set_search_path(db, user.company.schema_name)
    svc = ByproductKindService(db, user)
    added = []
    for name, shown in KINDS:
        try:
            kind = svc.create(name)
        except ConflictError:
            continue
        if not shown:
            svc.update(kind["id"], is_active=False)
        added.append(name)
    return f"{username}: by-products {', '.join(added)}" if added else f"{username}: by-products already seeded"
