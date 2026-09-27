"""Pydantic request schema for saved locations (Phase 3). Moved verbatim,
including the HTML-stripping validator."""

import re

from pydantic import BaseModel, Field, field_validator


class LocationCreate(BaseModel):
    label: str = Field(..., min_length=2, max_length=120)
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    country: str | None = Field(default=None, max_length=80)
    region: str | None = Field(default=None, max_length=120)
    is_default: bool = False

    @field_validator("label", "country", "region")
    @classmethod
    def _strip_html(cls, v: str | None) -> str | None:
        if v is None:
            return None
        clean = re.sub(r"[<>\x00-\x1f\x7f]", "", v).strip()
        return clean or None
