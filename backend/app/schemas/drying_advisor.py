"""Response contract for the palay Drying Advisor.

The model's JSON output is untrusted content from a third party: it is parsed
and validated against this schema before ever reaching a client. A field that
doesn't fit (wrong type, too long, an unrecognized verdict) fails the whole
advisory rather than passing through partially-shaped data.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DryingVerdict = Literal["good", "caution", "poor"]


class DryingAdvisory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: DryingVerdict
    headline: str = Field(min_length=1, max_length=80)
    reasoning: str = Field(min_length=1, max_length=280)
    best_window: str | None = Field(default=None, max_length=60)
    generated_at: str
    location: dict[str, float | str | None]
    cached: bool = False
