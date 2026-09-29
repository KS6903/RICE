"""Every recipe an Enterprise tenant can switch on, by code."""

from __future__ import annotations

from ..base import Recipe
from .owner_digest import OWNER_DIGEST

RECIPES: dict[str, Recipe] = {recipe.code: recipe for recipe in (OWNER_DIGEST,)}
