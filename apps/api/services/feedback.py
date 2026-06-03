"""Coach feedback and manual grade persistence over Supabase."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from models.feedback import SubmissionFeedback, UpsertFeedbackRequest
from services.classroom import _require_coach, _select
from services.supabase_client import get_supabase

_FEEDBACK = "submission_feedback"
_RECIPIENTS = "assignment_recipients"
_ASSIGNMENTS = "assignments"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_recipient(recipient_id: str) -> dict[str, Any] | None:
    rows = await _select(_RECIPIENTS, filters={"id": recipient_id}, limit=1)
    return rows[0] if rows else None


async def _get_assignment_class(assignment_id: str) -> str | None:
    rows = await _select(_ASSIGNMENTS, filters={"id": assignment_id}, limit=1)
    return rows[0]["class_id"] if rows else None


async def _resolve_class_for_recipient(recipient_id: str) -> tuple[dict[str, Any], str]:
    """Return (recipient_row, class_id) for a given recipient_id."""
    recipient = await _get_recipient(recipient_id)
    if recipient is None:
        raise LookupError("Recipient not found")
    class_id = await _get_assignment_class(recipient["assignment_id"])
    if class_id is None:
        raise LookupError("Assignment not found")
    return recipient, class_id


async def _fetch_feedback(recipient_id: str) -> dict[str, Any] | None:
    rows = await _select(_FEEDBACK, filters={"recipient_id": recipient_id}, limit=1)
    return rows[0] if rows else None


async def get_feedback(user_id: str, recipient_id: str) -> SubmissionFeedback | None:
    """Return feedback for a recipient.

    Allowed callers:
    - A coach of the recipient's class.
    - The student who owns the recipient.
    """
    recipient, class_id = await _resolve_class_for_recipient(recipient_id)

    # Check if user is the owning student OR a coach.
    is_owner = recipient["user_id"] == user_id
    if not is_owner:
        # Will raise PermissionError if not a coach.
        await _require_coach(class_id, user_id)

    row = await _fetch_feedback(recipient_id)
    if row is None:
        return None

    # Students may only see feedback that has been explicitly returned to them.
    if is_owner and not row.get("returned"):
        return None

    return SubmissionFeedback.model_validate(row)


async def upsert_feedback(
    coach_id: str,
    recipient_id: str,
    req: UpsertFeedbackRequest,
) -> SubmissionFeedback:
    """Create or update feedback for a recipient (coach only)."""
    recipient, class_id = await _resolve_class_for_recipient(recipient_id)
    await _require_coach(class_id, coach_id)

    existing = await _fetch_feedback(recipient_id)
    client = get_supabase()

    if existing is None:
        payload: dict[str, Any] = {
            "recipient_id": recipient_id,
            "coach_id": coach_id,
            "returned": False,
        }
        if req.grade is not None:
            payload["grade"] = req.grade
        if req.feedback is not None:
            payload["feedback"] = req.feedback
        if req.returned is not None:
            payload["returned"] = req.returned

        def _do_insert() -> dict[str, Any]:
            resp = client.table(_FEEDBACK).insert(payload).execute()
            data = getattr(resp, "data", None) or []
            if not data:
                raise RuntimeError("feedback insert returned no rows")
            return data[0]

        row = await asyncio.to_thread(_do_insert)
    else:
        update_payload: dict[str, Any] = {
            "updated_at": _now_iso(),
            "coach_id": coach_id,
        }
        if req.grade is not None:
            update_payload["grade"] = req.grade
        if req.feedback is not None:
            update_payload["feedback"] = req.feedback
        if req.returned is not None:
            update_payload["returned"] = req.returned

        def _do_update() -> dict[str, Any]:
            resp = (
                client.table(_FEEDBACK)
                .update(update_payload)
                .eq("recipient_id", recipient_id)
                .execute()
            )
            data = getattr(resp, "data", None) or []
            if not data:
                raise RuntimeError("feedback update returned no rows")
            return data[0]

        row = await asyncio.to_thread(_do_update)

    return SubmissionFeedback.model_validate(row)
