"""Every recipe an Enterprise tenant can switch on, by code, in page order."""

from __future__ import annotations

from ..base import Recipe
from ..cash import RECIPE_DEF as CASH_COUNT
from ..freshness import RECIPE_DEF as OFFLINE_DATA
from .advisor import ADVISOR_RECIPES, MONTH_IN_REVIEW
from .deliveries import DELIVERY_RECIPES
from .owner_digest import OWNER_DIGEST
from .people import PEOPLE_RECIPES
from .production import PRODUCTION_RECIPES
from .receivables import RECEIVABLES_RECIPES
from .reports import REPORT_RECIPES
from .stock import STOCK_RECIPES
from .watch import WATCH_RECIPES

RECIPES: dict[str, Recipe] = {
    recipe.code: recipe
    for recipe in (
        *ADVISOR_RECIPES,
        OWNER_DIGEST,
        *REPORT_RECIPES,
        CASH_COUNT,
        OFFLINE_DATA,
        MONTH_IN_REVIEW,
        *WATCH_RECIPES,
        *PRODUCTION_RECIPES,
        *STOCK_RECIPES,
        *RECEIVABLES_RECIPES,
        *DELIVERY_RECIPES,
        *PEOPLE_RECIPES,
    )
}
