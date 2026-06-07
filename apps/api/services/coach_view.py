"""Assignment submission detail service.

Provides helpers that let coaches review any student submission and lets
students open their own completed assignment details through a separate
student-facing route.
"""

from __future__ import annotations

import asyncio
from typing import Any

from services.classroom import (
    _ASSIGNMENTS,
    _RECIPIENTS,
    _SUBMISSIONS,
    _require_coach,
    _select,
)
from services.supabase_client import get_supabase


async def get_round_any(round_id: str) -> dict[str, Any] | None:
    """Fetch a round by id without user_id scoping (coach view)."""

    def _do() -> dict[str, Any] | None:
        client = get_supabase()
        resp = (
            client.table("rounds")
            .select("*")
            .eq("id", round_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    return await asyncio.to_thread(_do)


async def get_drill_any(drill_id: str) -> dict[str, Any] | None:
    """Fetch a drill by id without user_id scoping (coach view)."""

    def _do() -> dict[str, Any] | None:
        client = get_supabase()
        resp = (
            client.table("drills")
            .select("*")
            .eq("id", drill_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    return await asyncio.to_thread(_do)


async def get_case_review_any(case_review_id: str) -> dict[str, Any] | None:
    """Fetch a case review by id without user_id scoping (coach view)."""

    def _do() -> dict[str, Any] | None:
        client = get_supabase()
        resp = (
            client.table("case_reviews")
            .select("*")
            .eq("id", case_review_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    return await asyncio.to_thread(_do)


async def _get_recipient(recipient_id: str) -> dict[str, Any]:
    rows = await _select(_RECIPIENTS, filters={"id": recipient_id}, limit=1)
    if not rows:
        raise LookupError("Recipient not found")
    return rows[0]


async def _get_assignment(
    assignment_id: str,
    class_id: str | None = None,
) -> dict[str, Any]:
    filters: dict[str, Any] = {"id": assignment_id}
    if class_id is not None:
        filters["class_id"] = class_id
    rows = await _select(_ASSIGNMENTS, filters=filters, limit=1)
    if not rows:
        if class_id is not None:
            raise LookupError("Recipient does not belong to this class")
        raise LookupError("Assignment not found")
    return rows[0]


async def _get_submission(recipient_id: str) -> dict[str, Any] | None:
    rows = await _select(
        _SUBMISSIONS,
        filters={"recipient_id": recipient_id},
        order=("created_at", True),
        limit=1,
    )
    return rows[0] if rows else None


async def _build_submission_payload(
    recipient_row: dict[str, Any],
    assignment_row: dict[str, Any],
    submission_row: dict[str, Any] | None,
) -> dict[str, Any]:
    round_data: dict[str, Any] | None = None
    drill_data: dict[str, Any] | None = None
    case_review_data: dict[str, Any] | None = None
    submission_type: str | None = None

    if submission_row:
        if submission_row.get("round_id"):
            submission_type = "round"
            round_data = await get_round_any(submission_row["round_id"])
        elif submission_row.get("drill_id"):
            submission_type = "drill"
            drill_data = await get_drill_any(submission_row["drill_id"])
        elif submission_row.get("case_review_id"):
            submission_type = "case"
            case_review_data = await get_case_review_any(submission_row["case_review_id"])

    if submission_type is None:
        assignment_type = assignment_row.get("type")
        if assignment_type == "drill":
            submission_type = "drill"
        elif assignment_type == "case":
            submission_type = "case"
        else:
            submission_type = "round"

    return {
        "type": submission_type,
        "round": round_data,
        "drill": drill_data,
        "case_review": case_review_data,
        "recipient": recipient_row,
        "assignment": assignment_row,
        "submission": submission_row,
    }


async def get_submission_for_coach(
    coach_id: str,
    class_id: str,
    recipient_id: str,
) -> dict[str, Any]:
    """Return the full submission payload for a coach reviewing a student.

    Raises:
        PermissionError: caller is not a coach of class_id
        LookupError: recipient_id not found or does not belong to this class
    """
    await _require_coach(class_id, coach_id)
    recipient_row = await _get_recipient(recipient_id)
    assignment_row = await _get_assignment(recipient_row["assignment_id"], class_id=class_id)
    submission_row = await _get_submission(recipient_id)
    return await _build_submission_payload(recipient_row, assignment_row, submission_row)


async def get_submission_for_student(
    student_id: str,
    recipient_id: str,
) -> dict[str, Any]:
    """Return the full submission payload for the owning student."""

    recipient_row = await _get_recipient(recipient_id)
    if recipient_row.get("user_id") != student_id:
        raise PermissionError("Recipient does not belong to this user")

    assignment_row = await _get_assignment(recipient_row["assignment_id"])
    submission_row = await _get_submission(recipient_id)
    return await _build_submission_payload(recipient_row, assignment_row, submission_row)
