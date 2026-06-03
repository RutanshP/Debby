"""Request / response models for class admin operations."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class UpdateClassRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None


class UpdateAssignmentRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    due_at: datetime | None = None
