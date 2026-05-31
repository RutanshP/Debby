from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from models.topic_limits import validate_topic_word_limit


Format = Literal["parli", "mspdp"]
Side = Literal["aff", "neg"]
MAX_SAVED_CASE_TITLE_CHARS = 240


def normalize_saved_case_title(title: str) -> str:
    title = title.strip()
    if len(title) <= MAX_SAVED_CASE_TITLE_CHARS:
        return title
    return title[: MAX_SAVED_CASE_TITLE_CHARS - 3].rstrip() + "..."


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
    title: str = Field(min_length=1, max_length=MAX_SAVED_CASE_TITLE_CHARS)
    topic: str = Field(min_length=1)
    format: Format
    side: Side
    content: str = Field(min_length=1)

    @field_validator("title", mode="before")
    @classmethod
    def title_must_fit_storage_limit(cls, value: str) -> str:
        return normalize_saved_case_title(str(value))

    @field_validator("topic")
    @classmethod
    def topic_must_not_exceed_word_limit(cls, value: str) -> str:
        return validate_topic_word_limit(value)
