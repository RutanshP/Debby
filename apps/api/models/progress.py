"""Pydantic models for compact progress loading."""

from __future__ import annotations

from pydantic import BaseModel

from models.drill import DrillSummary
from models.insights import SpeechInsights
from models.round import RoundSummary


class ProgressSummary(BaseModel):
    rounds: list[RoundSummary]
    drills: list[DrillSummary]
    insights: SpeechInsights | None = None
