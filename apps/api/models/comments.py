"""Pydantic models for the comments feature."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class Comment(BaseModel):
    id: str
    class_id: str
    target_type: str
    target_id: str
    author_id: str
    body: str
    is_private: bool = False
    created_at: datetime | str | None = None


class CreateCommentRequest(BaseModel):
    class_id: str
    target_type: str = Field(pattern=r"^(post|assignment)$")
    target_id: str
    body: str = Field(min_length=1, max_length=4000)
    is_private: bool = False
