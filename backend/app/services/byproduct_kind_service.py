"""The by-products a mill handles: ipa, darak and binlid, which every mill has
and milling makes, and the ones its Boss adds (Stock > Catalog).

Stock, purchases and sales lines keep a by-product's code, a short slug; this
list gives each code its name. A code typed in somewhere without being added
first (the Add stock window lets you type one) is added here when it's saved.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from ..core.exceptions import ConflictError, NotFoundError, ValidationError
from ..models.reference import ByproductKind
from .base import BaseService

# Milling's yields are counted in these, so they can't be renamed or hidden.
BUILT_IN: dict[str, str] = {
    "ipa": "Ipa (Rice Hull)",
    "darak": "Darak (Rice Bran)",
    "binlid": "Binlid (Broken Rice)",
}

CODE_LENGTH = 20


def code_for(name: str) -> str:
    """ "Darak D1" → "darak_d1": lower case, anything else an underscore."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:CODE_LENGTH].rstrip("_")


def byproduct_name(code: str) -> str:
    """A code's name for a log line: a built-in's, or the code in words. (The
    current schema's own names need a session; logs keep it simple.)"""
    return BUILT_IN.get(code) or name_for(code)


def name_for(code: str) -> str:
    """A name for a code nobody named: "darak_d1" → "Darak d1"."""
    return code.replace("_", " ").capitalize()


class ByproductKindService(BaseService):
    def list_kinds(self, *, include_hidden: bool = False) -> list[dict[str, Any]]:
        built_in = [
            {"id": None, "code": code, "name": name, "built_in": True, "is_active": True}
            for code, name in BUILT_IN.items()
        ]
        q = self.db.query(ByproductKind).filter(ByproductKind.company_id == self.current_user.company_id)
        if not include_hidden:
            q = q.filter(ByproductKind.is_active.is_(True))
        own = sorted(q.all(), key=lambda k: k.name.lower())
        return built_in + [self._row(k) for k in own]

    def create(self, name: str) -> dict[str, Any]:
        name = self._name(name)
        code = code_for(name)
        if not code:
            raise ValidationError("Use letters or numbers in the name.")
        if code in BUILT_IN or self._by_code(code):
            raise ConflictError(f"There's already a by-product called {name}.", code="byproduct_exists")
        kind = ByproductKind(company_id=self.current_user.company_id, code=code, name=name)
        with self.transaction():
            self.db.add(kind)
        self.db.refresh(kind)
        return self._row(kind)

    def update(self, kind_id: uuid.UUID, *, name: str | None = None, is_active: bool | None = None) -> dict[str, Any]:
        """Rename one (its code stays, so its stock and records keep it), or
        hide it from the pickers and show it again."""
        kind = self.db.get(ByproductKind, kind_id)
        if not kind or kind.company_id != self.current_user.company_id:
            raise NotFoundError("By-product not found")
        with self.transaction():
            if name is not None:
                kind.name = self._name(name, exclude_id=kind.id)
            if is_active is not None:
                kind.is_active = is_active
        self.db.refresh(kind)
        return self._row(kind)

    def ensure(self, code: str) -> None:
        """Add a code saved without being on the list first. Flush only; the
        caller's transaction commits it with the record that uses it."""
        if code in BUILT_IN or self._by_code(code):
            return
        self.db.add(ByproductKind(company_id=self.current_user.company_id, code=code, name=name_for(code)))
        self.db.flush()

    def _by_code(self, code: str) -> ByproductKind | None:
        return (
            self.db.query(ByproductKind)
            .filter(ByproductKind.company_id == self.current_user.company_id, ByproductKind.code == code)
            .first()
        )

    def _name(self, name: str, *, exclude_id: uuid.UUID | None = None) -> str:
        name = " ".join(name.split())
        if not name:
            raise ValidationError("Give the by-product a name.")
        taken = {n.lower() for n in BUILT_IN.values()}
        q = self.db.query(ByproductKind.name).filter(ByproductKind.company_id == self.current_user.company_id)
        if exclude_id is not None:
            q = q.filter(ByproductKind.id != exclude_id)
        taken |= {n.lower() for (n,) in q.all()}
        if name.lower() in taken:
            raise ConflictError(f"There's already a by-product called {name}.", code="byproduct_exists")
        return name

    @staticmethod
    def _row(kind: ByproductKind) -> dict[str, Any]:
        return {"id": kind.id, "code": kind.code, "name": kind.name, "built_in": False, "is_active": kind.is_active}
