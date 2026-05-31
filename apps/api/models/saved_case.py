from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Format = Literal["parli", "mspdp"]
Side = Literal["aff", "neg"]


class SavedCase(BaseModel):
    id: str
    user_id: str
    title: str
    topic: str
    format: Format
    side: Side
    content: str
    created_at: str | None = None
    updated_at: str | None = None


class SavedCaseSummary(BaseModel):
    id: str
    title: str
    topic: str
    format: Format
    side: Side
    created_at: str | None = None
    updated_at: str | None = None


class CreateSavedCaseRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    topic: str = Field(min_length=1)
    format: Format
    side: Side
    content: str = Field(min_length=1)
