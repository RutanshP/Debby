"""Pydantic models for the class stream (posts)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, field_validator

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

    @field_validator("link_url")
    @classmethod
    def _validate_link_url(cls, v: str | None) -> str | None:
        if v is None:
            return v
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("link_url must use http or https scheme")
        return v
