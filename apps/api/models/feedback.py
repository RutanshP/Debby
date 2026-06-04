"""Models for coach submission feedback and manual grades."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SubmissionFeedback(BaseModel):
    id: str
    recipient_id: str
    coach_id: str | None = None
    grade: float | None = None
    feedback: str | None = None
    returned: bool = False
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class UpsertFeedbackRequest(BaseModel):
    grade: float | None = None
    feedback: str | None = None
    returned: bool | None = None
