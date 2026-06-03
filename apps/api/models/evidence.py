from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Side = Literal["aff", "neg"]


class EvidenceCard(BaseModel):
    tag: str
    evidence: str
    source_title: str
    source_url: str
    source_type: str | None = None


class TopicEvidence(BaseModel):
    topic: str
    side: Side
    cards: list[EvidenceCard] = Field(default_factory=list)
    generated_at: str | None = None
    updated_at: str | None = None
