from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from models.drill import DrillType
from models.round import Format, Side
from models.topic_limits import validate_topic_word_limit

ClassRole = Literal["coach", "competitor"]
AssignmentType = Literal["drill", "practice_round", "case"]
AssignmentStatus = Literal["assigned", "in_progress", "completed"]

DRILL_TIMERS = {30, 60, 120}
PRACTICE_TIMERS = {30, 45, 60, 90, 120, 180, 240, 300}
MAX_CASE_TEXT_WORDS = 6000


class ClassRoom(BaseModel):
    id: str
    name: str
    join_code: str
    created_by: str
    created_at: datetime | str | None = None
    archived: bool = False


class ClassMember(BaseModel):
    class_id: str
    user_id: str
    role: ClassRole
    joined_at: datetime | str | None = None


class DrillAssignmentPayload(BaseModel):
    drill_type: DrillType
    timer_seconds: int

    @field_validator("timer_seconds")
    @classmethod
    def timer_must_be_supported(cls, value: int) -> int:
        if value not in DRILL_TIMERS:
            raise ValueError("Unsupported drill timer")
        return value


class PracticeRoundAssignmentPayload(BaseModel):
    format: Format
    topic: str = Field(min_length=1)
    side: Side
    speech_duration_seconds: int

    @field_validator("topic")
    @classmethod
    def topic_must_be_valid(cls, value: str) -> str:
        return validate_topic_word_limit(value)

    @field_validator("speech_duration_seconds")
    @classmethod
    def timer_must_be_supported(cls, value: int) -> int:
        if value not in PRACTICE_TIMERS:
            raise ValueError("Unsupported practice timer")
        return value


class CaseAssignmentPayload(BaseModel):
    format: Format
    topic: str = ""
    side: Side
    content: str = Field(min_length=1)

    @field_validator("topic")
    @classmethod
    def topic_must_be_valid(cls, value: str) -> str:
        if not value.strip():
            return ""
        return validate_topic_word_limit(value)

    @field_validator("content")
    @classmethod
    def content_must_be_within_limit(cls, value: str) -> str:
        words = value.strip().split()
        if not value.strip():
            raise ValueError("Case text is required")
        if len(words) > MAX_CASE_TEXT_WORDS:
            raise ValueError(f"Case text must be {MAX_CASE_TEXT_WORDS} words or fewer")
        return value


AssignmentPayload = DrillAssignmentPayload | PracticeRoundAssignmentPayload | CaseAssignmentPayload


class Assignment(BaseModel):
    id: str
    class_id: str
    assigned_by: str
    title: str
    type: AssignmentType
    payload: dict[str, Any]
    due_at: datetime | str | None = None
    created_at: datetime | str | None = None


class AssignmentRecipient(BaseModel):
    id: str
    assignment_id: str
    user_id: str
    status: AssignmentStatus
    started_at: datetime | str | None = None
    completed_at: datetime | str | None = None
    created_at: datetime | str | None = None


class AssignmentSubmission(BaseModel):
    id: str
    recipient_id: str
    user_id: str
    drill_id: str | None = None
    round_id: str | None = None
    case_review_id: str | None = None
    created_at: datetime | str | None = None


class CreateClassRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class JoinClassRequest(BaseModel):
    join_code: str = Field(min_length=4, max_length=16)


class CreateAssignmentRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    type: AssignmentType
    payload: dict[str, Any]
    due_at: datetime | None = None
    recipient_user_ids: list[str] | None = None
    assign_all: bool = True


class CompleteAssignmentRequest(BaseModel):
    drill_id: str | None = None
    round_id: str | None = None
    case_review_id: str | None = None


class MatchDrillAssignmentRequest(BaseModel):
    drill_id: str


class ClassListItem(BaseModel):
    id: str
    name: str
    join_code: str
    role: ClassRole
    open_assignments: int
    created_at: datetime | str | None = None


class AssignmentRecipientDetail(BaseModel):
    recipient: AssignmentRecipient
    assignment: Assignment
    class_room: ClassRoom
    submission: AssignmentSubmission | None = None
    result: dict[str, Any] | None = None


class CoachAssignmentSummary(BaseModel):
    assignment: Assignment
    recipients: list[AssignmentRecipient]
    submissions: list[AssignmentSubmission] = Field(default_factory=list)
    results: dict[str, dict[str, Any]] = Field(default_factory=dict)


class ClassDetail(BaseModel):
    class_room: ClassRoom
    role: ClassRole
    roster: list[ClassMember]
    assignments: list[CoachAssignmentSummary | AssignmentRecipientDetail]


class StartAssignmentResponse(BaseModel):
    recipient: AssignmentRecipient
    assignment: Assignment
    round_id: str | None = None
