"""Pydantic models for the profiles feature."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class Profile(BaseModel):
    user_id: str
    display_name: str | None = None
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class UpdateProfileRequest(BaseModel):
    display_name: str = Field(min_length=1)

    @field_validator("display_name")
    @classmethod
    def display_name_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("display_name must not be blank")
        return stripped


class ProfileLookupRequest(BaseModel):
    user_ids: list[str]
