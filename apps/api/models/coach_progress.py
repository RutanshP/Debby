"""Pydantic models for the coach progress endpoint."""

from __future__ import annotations

from pydantic import BaseModel

from models.drill import DrillSummary
from models.round import RoundSummary


class StudentProgress(BaseModel):
    user_id: str
    rounds: list[RoundSummary]
    drills: list[DrillSummary]


class ClassProgressResponse(BaseModel):
    students: list[StudentProgress]
