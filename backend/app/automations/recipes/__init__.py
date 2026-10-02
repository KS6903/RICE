"""Every recipe an Enterprise tenant can switch on, by code, in page order."""

from __future__ import annotations

from ..base import Recipe
from .deliveries import DELIVERY_RECIPES
from .owner_digest import OWNER_DIGEST
from .production import PRODUCTION_RECIPES
from .receivables import RECEIVABLES_RECIPES
from .stock import STOCK_RECIPES
from .watch import WATCH_RECIPES

RECIPES: dict[str, Recipe] = {
    recipe.code: recipe
    for recipe in (
        OWNER_DIGEST,
        *WATCH_RECIPES,
        *PRODUCTION_RECIPES,
        *STOCK_RECIPES,
        *RECEIVABLES_RECIPES,
        *DELIVERY_RECIPES,
    )
}
