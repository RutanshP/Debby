"""Class-admin service: rename, archive, regenerate code, manage roster, edit/delete assignment."""

from __future__ import annotations

import asyncio
import random
import string
from typing import Any

from models.class_admin import UpdateAssignmentRequest, UpdateClassRequest
from models.classroom import Assignment, ClassRoom
from services.classroom import (
    _ASSIGNMENTS,
    _CLASSES,
    _MEMBERS,
    _get_class,
    _get_member,
    _insert,
    _require_coach,
    _require_member,
    _select,
    _update,
)
from services.supabase_client import get_supabase

_MAX_CODE_ATTEMPTS = 10


def _new_join_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(6))


async def _delete(table: str, filters: dict[str, Any]) -> None:
    """Delete rows matching all filters."""
    client = get_supabase()

    def _do() -> None:
        query = client.table(table).delete()
        for key, value in filters.items():
            query = query.eq(key, value)
        query.execute()

    await asyncio.to_thread(_do)


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def update_class(
    coach_id: str,
    class_id: str,
    req: UpdateClassRequest,
) -> ClassRoom:
    await _require_coach(class_id, coach_id)
    patch: dict[str, Any] = {}
    if req.name is not None:
        patch["name"] = req.name.strip()
    if req.archived is not None:
        patch["archived"] = req.archived
    if not patch:
        class_row = await _get_class(class_id)
        if class_row is None:
            raise LookupError("Class not found")
        return ClassRoom.model_validate(class_row)
    row = await _update(_CLASSES, {"id": class_id}, patch)
    return ClassRoom.model_validate(row)


async def regenerate_code(coach_id: str, class_id: str) -> ClassRoom:
    await _require_coach(class_id, coach_id)
    for _ in range(_MAX_CODE_ATTEMPTS):
        code = _new_join_code()
        # Check uniqueness
        existing = await _select(_CLASSES, filters={"join_code": code}, limit=1)
        if existing:
            continue
        try:
            row = await _update(_CLASSES, {"id": class_id}, {"join_code": code})
            return ClassRoom.model_validate(row)
        except LookupError:
            raise
        except Exception:
            continue
    raise RuntimeError("Could not generate a unique join code")


async def remove_member(coach_id: str, class_id: str, user_id: str) -> None:
    """A coach removes another member (competitor).  Cannot remove self or last coach."""
    await _require_coach(class_id, coach_id)
    if user_id == coach_id:
        raise PermissionError("A coach cannot remove themselves; use leave_class instead")
    target = await _get_member(class_id, user_id)
    if target is None:
        raise LookupError("Member not found in this class")
    if target.get("role") == "coach":
        # Protect last-coach invariant
        all_members = await _select(_MEMBERS, filters={"class_id": class_id})
        coaches = [m for m in all_members if m.get("role") == "coach"]
        if len(coaches) <= 1:
            raise PermissionError("Cannot remove the last coach from a class")
    await _delete(_MEMBERS, {"class_id": class_id, "user_id": user_id})


async def update_member_role(
    coach_id: str,
    class_id: str,
    user_id: str,
    role: str,
) -> dict[str, Any]:
    """Promote or demote a class member while preserving at least one coach."""
    normalized_role = role.strip().lower()
    if normalized_role not in {"coach", "competitor"}:
        raise ValueError("Unsupported class role")

    await _require_coach(class_id, coach_id)
    member = await _get_member(class_id, user_id)
    if member is None:
        raise LookupError("Member not found in this class")
    if member.get("role") == normalized_role:
        return member

    if member.get("role") == "coach" and normalized_role != "coach":
        all_members = await _select(_MEMBERS, filters={"class_id": class_id})
        coaches = [m for m in all_members if m.get("role") == "coach"]
        if len(coaches) <= 1:
            raise PermissionError("Cannot demote the last coach from a class")

    return await _update(
        _MEMBERS,
        {"class_id": class_id, "user_id": user_id},
        {"role": normalized_role},
    )


async def leave_class(user_id: str, class_id: str) -> None:
    """A member voluntarily leaves.  A coach may only leave when another coach remains."""
    member = await _require_member(class_id, user_id)
    if member.get("role") == "coach":
        all_members = await _select(_MEMBERS, filters={"class_id": class_id})
        coaches = [m for m in all_members if m.get("role") == "coach"]
        if len(coaches) <= 1:
            raise PermissionError("You are the last coach; transfer ownership before leaving")
    await _delete(_MEMBERS, {"class_id": class_id, "user_id": user_id})


async def update_assignment(
    coach_id: str,
    assignment_id: str,
    req: UpdateAssignmentRequest,
) -> Assignment:
    # Fetch assignment to get class_id for auth check.
    rows = await _select(_ASSIGNMENTS, filters={"id": assignment_id}, limit=1)
    if not rows:
        raise LookupError("Assignment not found")
    assignment_row = rows[0]
    await _require_coach(assignment_row["class_id"], coach_id)

    patch: dict[str, Any] = {}
    if req.title is not None:
        patch["title"] = req.title.strip()
    # Use model_fields_set to distinguish "not provided" from "explicitly set to null".
    if "due_at" in req.model_fields_set:
        patch["due_at"] = req.due_at.isoformat() if req.due_at is not None else None
    if not patch:
        return Assignment.model_validate(assignment_row)
    row = await _update(_ASSIGNMENTS, {"id": assignment_id}, patch)
    return Assignment.model_validate(row)


async def delete_assignment(coach_id: str, assignment_id: str) -> None:
    rows = await _select(_ASSIGNMENTS, filters={"id": assignment_id}, limit=1)
    if not rows:
        raise LookupError("Assignment not found")
    assignment_row = rows[0]
    await _require_coach(assignment_row["class_id"], coach_id)
    await _delete(_ASSIGNMENTS, {"id": assignment_id})
