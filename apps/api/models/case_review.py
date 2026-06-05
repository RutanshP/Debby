from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from models.saved_case import Format, Side
from models.topic_limits import validate_topic_word_limit

CaseCategory = Literal["Unusable", "Fragile", "Usable", "Strong", "Excellent"]
MAX_CASE_REVIEW_WORDS = 6000


class CaseReview(BaseModel):
    id: str
    user_id: str
    format: Format
    topic: str
    side: Side
    source_text: str
    score: int
    category: CaseCategory
    summary: str
    feedback: str
    created_at: str | None = None
    updated_at: str | None = None


class CreateCaseReviewRequest(BaseModel):
    format: Format
    topic: str = ""
    side: Side
    source_text: str = Field(min_length=1)
    score: int = Field(ge=1, le=10)
    category: CaseCategory
    summary: str = Field(min_length=1)
    feedback: str = Field(min_length=1)

    @field_validator("topic")
    @classmethod
    def topic_must_not_exceed_word_limit(cls, value: str) -> str:
        if not value.strip():
            return ""
        return validate_topic_word_limit(value)

    @field_validator("source_text")
    @classmethod
    def source_text_must_be_within_limit(cls, value: str) -> str:
        if len(value.strip().split()) > MAX_CASE_REVIEW_WORDS:
            raise ValueError(
                f"Case text must be {MAX_CASE_REVIEW_WORDS} words or fewer"
            )
        return value
