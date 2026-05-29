"""Pydantic models for the drills feature."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from models.round import WpmPoint

DrillType = Literal["rebuttal", "speed", "impact", "contention"]

# Legacy code used "contentions" (plural); we expose the singular form publicly
# but translate when calling into the legacy-style prompt builder.
_LEGACY_TYPE = {
    "rebuttal": "rebuttal",
    "speed": "speed",
    "impact": "impact",
    "contention": "contentions",
}

DRILL_TITLES = {
    "rebuttal": "Rebuttal Speech",
    "speed": "Speed Reading",
    "impact": "Impact Extension",
    "contention": "Contention Storm",
}


class DrillPrompt(BaseModel):
    """The generated prompt text the user practices against."""

    title: str
    topic: str
    prompt: str
    task: str
    timer_seconds: int


class DrillCreateRequest(BaseModel):
    drill_type: DrillType
    timer_seconds: int | None = None


class DrillScoreRequest(BaseModel):
    response: str = Field(min_length=1)


class DrillScore(BaseModel):
    """Structured output from text scoring."""

    score: int = Field(ge=0, le=10)
    feedback: str
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)


class SpeedScore(BaseModel):
    accuracy: float
    completion: float
    duration_seconds: float
    wpm: int
    wpm_series: list[WpmPoint] = Field(default_factory=list)
    score: int | None = Field(default=None, ge=0, le=10)


class Drill(BaseModel):
    """A persisted drill row."""

    id: str
    user_id: str
    drill_type: DrillType
    prompt: DrillPrompt
    response: str | None = None
    score: DrillScore | SpeedScore | None = None
    timer_seconds: int | None = None
    created_at: datetime | None = None
