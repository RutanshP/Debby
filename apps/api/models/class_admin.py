"""Request / response models for class admin operations."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class UpdateClassRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None


class UpdateMemberRoleRequest(BaseModel):
    role: str = Field(min_length=1)


class UpdateAssignmentRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    # Callers may send due_at: null to explicitly clear an existing deadline.
    # The service uses model_fields_set to distinguish "not sent" from "sent as null".
    due_at: datetime | None = Field(default=None)
