"""Response models for the coach submission viewer endpoint."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from models.classroom import Assignment, AssignmentRecipient, AssignmentSubmission


class CoachSubmissionResponse(BaseModel):
    """Full submission payload returned to a coach for a given recipient."""

    type: Literal["round", "drill", "case"]
    round: dict[str, Any] | None = None
    drill: dict[str, Any] | None = None
    case_review: dict[str, Any] | None = None
    recipient: dict[str, Any]
    assignment: dict[str, Any]
    submission: dict[str, Any] | None = None
