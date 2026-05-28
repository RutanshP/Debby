"""Pydantic models for cached speech insights."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SpeechInsightsSummary(BaseModel):
    headline: str
    strengths: list[str] = Field(default_factory=list)
    recurring_issues: list[str] = Field(default_factory=list)
    suggested_focus: str


class SpeechInsights(BaseModel):
    summary: SpeechInsightsSummary
    rounds_covered: int
    generated_at: datetime
