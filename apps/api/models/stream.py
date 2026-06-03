"""Pydantic models for the class stream (posts)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

PostType = Literal["announcement", "material"]


class ClassPost(BaseModel):
    id: str
    class_id: str
    author_id: str
    type: PostType
    title: str | None = None
    body: str | None = None
    link_url: str | None = None
    created_at: datetime | str | None = None


class CreatePostRequest(BaseModel):
    type: PostType
    title: str | None = None
    body: str | None = None
    link_url: str | None = None
