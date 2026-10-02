"""Every recipe an Enterprise tenant can switch on, by code, in page order."""

from __future__ import annotations

from ..base import Recipe
from .owner_digest import OWNER_DIGEST
from .watch import WATCH_RECIPES

RECIPES: dict[str, Recipe] = {recipe.code: recipe for recipe in (OWNER_DIGEST, *WATCH_RECIPES)}
