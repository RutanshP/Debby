"""Coach submission viewer service.

Provides helpers that let a coach read any round or drill without
being scoped to a specific user_id (the service-role Supabase client
bypasses RLS), plus a high-level entry point that validates coach
authorization before returning the full submission payload.
"""

from __future__ import annotations

import asyncio
from typing import Any

from services.classroom import (
    _ASSIGNMENTS,
    _MEMBERS,
    _RECIPIENTS,
    _SUBMISSIONS,
    _get_class,
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
    # 1. Verify coach role.
    await _require_coach(class_id, coach_id)

    # 2. Load the recipient row.
    recipient_rows = await _select(_RECIPIENTS, filters={"id": recipient_id}, limit=1)
    if not recipient_rows:
        raise LookupError("Recipient not found")
    recipient_row = recipient_rows[0]

    # 3. Verify recipient belongs to an assignment in this class.
    assignment_rows = await _select(
        _ASSIGNMENTS,
        filters={"id": recipient_row["assignment_id"], "class_id": class_id},
        limit=1,
    )
    if not assignment_rows:
        raise LookupError("Recipient does not belong to this class")
    assignment_row = assignment_rows[0]

    # 4. Find the submission.
    submission_rows = await _select(
        _SUBMISSIONS,
        filters={"recipient_id": recipient_id},
        order=("created_at", True),
        limit=1,
    )
    submission_row = submission_rows[0] if submission_rows else None

    # 5. Resolve round or drill.
    round_data: dict[str, Any] | None = None
    drill_data: dict[str, Any] | None = None
    submission_type: str | None = None

    if submission_row:
        if submission_row.get("round_id"):
            submission_type = "round"
            round_data = await get_round_any(submission_row["round_id"])
        elif submission_row.get("drill_id"):
            submission_type = "drill"
            drill_data = await get_drill_any(submission_row["drill_id"])

    # Determine type from assignment if no submission yet.
    if submission_type is None:
        submission_type = (
            "drill" if assignment_row.get("type") == "drill" else "round"
        )

    return {
        "type": submission_type,
        "round": round_data,
        "drill": drill_data,
        "recipient": recipient_row,
        "assignment": assignment_row,
        "submission": submission_row,
    }
