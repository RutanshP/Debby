"""Classroom and assignment persistence over Supabase."""

from __future__ import annotations

import asyncio
import random
import string
from datetime import datetime, timezone
from typing import Any

from models.classroom import (
    Assignment,
    AssignmentRecipient,
    AssignmentRecipientDetail,
    AssignmentSubmission,
    AssignmentType,
    ClassDetail,
    ClassListItem,
    ClassMember,
    ClassRoom,
    CoachAssignmentSummary,
    CreateAssignmentRequest,
    DrillAssignmentPayload,
    PracticeRoundAssignmentPayload,
    StartAssignmentResponse,
)
from services import rounds as rounds_service
from services.supabase_client import get_supabase

_CLASSES = "classes"
_MEMBERS = "class_members"
_ASSIGNMENTS = "assignments"
_RECIPIENTS = "assignment_recipients"
_SUBMISSIONS = "assignment_submissions"


def _client():
    return get_supabase()


async def _select(
    table: str,
    *,
    filters: dict[str, Any] | None = None,
    order: tuple[str, bool] | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    client = _client()

    def _do() -> list[dict[str, Any]]:
        query = client.table(table).select("*")
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        if order:
            query = query.order(order[0], desc=order[1])
        if limit is not None:
            query = query.limit(limit)
        resp = query.execute()
        return list(getattr(resp, "data", None) or [])

    return await asyncio.to_thread(_do)


async def _insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = _client()

    def _do() -> dict[str, Any]:
        resp = client.table(table).insert(payload).execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError(f"{table} insert returned no rows")
        return data[0]

    return await asyncio.to_thread(_do)


async def _update(
    table: str,
    filters: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    client = _client()

    def _do() -> dict[str, Any]:
        query = client.table(table).update(payload)
        for key, value in filters.items():
            query = query.eq(key, value)
        resp = query.execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise LookupError(f"{table} update returned no rows")
        return data[0]

    return await asyncio.to_thread(_do)


def _new_join_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(6))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_payload(kind: AssignmentType, payload: dict[str, Any]) -> dict[str, Any]:
    if kind == "drill":
        return DrillAssignmentPayload.model_validate(payload).model_dump()
    return PracticeRoundAssignmentPayload.model_validate(payload).model_dump()


async def _get_class(class_id: str) -> dict[str, Any] | None:
    rows = await _select(_CLASSES, filters={"id": class_id}, limit=1)
    return rows[0] if rows else None


async def _get_member(class_id: str, user_id: str) -> dict[str, Any] | None:
    rows = await _select(
        _MEMBERS,
        filters={"class_id": class_id, "user_id": user_id},
        limit=1,
    )
    return rows[0] if rows else None


async def _require_member(class_id: str, user_id: str) -> dict[str, Any]:
    member = await _get_member(class_id, user_id)
    if member is None:
        raise PermissionError("Not a class member")
    return member


async def _require_coach(class_id: str, user_id: str) -> None:
    member = await _require_member(class_id, user_id)
    if member.get("role") != "coach":
        raise PermissionError("Coach role required")


async def create_class(*, user_id: str, name: str) -> ClassRoom:
    for _ in range(8):
        join_code = _new_join_code()
        try:
            row = await _insert(
                _CLASSES,
                {
                    "name": name.strip(),
                    "join_code": join_code,
                    "created_by": user_id,
                },
            )
            await _insert(
                _MEMBERS,
                {
                    "class_id": row["id"],
                    "user_id": user_id,
                    "role": "coach",
                },
            )
            return ClassRoom.model_validate(row)
        except Exception:
            continue
    raise RuntimeError("Could not create a unique class code")


async def join_class(*, user_id: str, join_code: str) -> ClassRoom:
    code = join_code.strip().upper()
    rows = await _select(_CLASSES, filters={"join_code": code}, limit=1)
    if not rows:
        raise LookupError("Class not found")
    class_row = rows[0]
    existing = await _get_member(class_row["id"], user_id)
    if existing is None:
        await _insert(
            _MEMBERS,
            {
                "class_id": class_row["id"],
                "user_id": user_id,
                "role": "competitor",
            },
        )
    return ClassRoom.model_validate(class_row)


async def list_classes(*, user_id: str) -> list[ClassListItem]:
    memberships = await _select(_MEMBERS, filters={"user_id": user_id})
    items: list[ClassListItem] = []
    for membership in memberships:
        class_row = await _get_class(membership["class_id"])
        if class_row is None:
            continue
        open_count = 0
        if membership.get("role") == "competitor":
            recipients = await _select(_RECIPIENTS, filters={"user_id": user_id})
            assignment_ids = {
                row["id"]
                for row in await _select(_ASSIGNMENTS, filters={"class_id": class_row["id"]})
            }
            open_count = sum(
                1
                for recipient in recipients
                if recipient.get("assignment_id") in assignment_ids
                and recipient.get("status") != "completed"
            )
        items.append(
            ClassListItem(
                id=class_row["id"],
                name=class_row["name"],
                join_code=class_row["join_code"],
                role=membership["role"],
                open_assignments=open_count,
                created_at=class_row.get("created_at"),
            )
        )
    return items


async def create_assignment(
    *,
    user_id: str,
    class_id: str,
    request: CreateAssignmentRequest,
) -> CoachAssignmentSummary:
    await _require_coach(class_id, user_id)
    payload = _validate_payload(request.type, request.payload)

    members = await _select(_MEMBERS, filters={"class_id": class_id})
    competitors = [m for m in members if m.get("role") == "competitor"]
    allowed_ids = {m["user_id"] for m in competitors}
    if request.assign_all:
        recipient_ids = sorted(allowed_ids)
    else:
        recipient_ids = request.recipient_user_ids or []
        if not recipient_ids or any(recipient_id not in allowed_ids for recipient_id in recipient_ids):
            raise PermissionError("Recipients must be competitors in this class")
    if not recipient_ids:
        raise ValueError("Assignment needs at least one competitor")

    assignment_row = await _insert(
        _ASSIGNMENTS,
        {
            "class_id": class_id,
            "assigned_by": user_id,
            "title": request.title.strip(),
            "type": request.type,
            "payload": payload,
            "due_at": request.due_at.isoformat() if request.due_at else None,
        },
    )
    recipients = [
        AssignmentRecipient.model_validate(
            await _insert(
                _RECIPIENTS,
                {
                    "assignment_id": assignment_row["id"],
                    "user_id": recipient_id,
                    "status": "assigned",
                },
            )
        )
        for recipient_id in recipient_ids
    ]
    return CoachAssignmentSummary(
        assignment=Assignment.model_validate(assignment_row),
        recipients=recipients,
    )


async def _submission_for_recipient(recipient_id: str) -> dict[str, Any] | None:
    rows = await _select(
        _SUBMISSIONS,
        filters={"recipient_id": recipient_id},
        order=("created_at", True),
        limit=1,
    )
    return rows[0] if rows else None


async def _result_for_submission(submission: dict[str, Any] | None) -> dict[str, Any] | None:
    if not submission:
        return None
    if submission.get("drill_id"):
        rows = await _select(
            "drills",
            filters={"id": submission["drill_id"], "user_id": submission["user_id"]},
            limit=1,
        )
        return rows[0] if rows else None
    if submission.get("round_id"):
        rows = await _select(
            "rounds",
            filters={"id": submission["round_id"], "user_id": submission["user_id"]},
            limit=1,
        )
        return rows[0] if rows else None
    return None


async def _recipient_detail(recipient_row: dict[str, Any]) -> AssignmentRecipientDetail:
    assignments = await _select(
        _ASSIGNMENTS,
        filters={"id": recipient_row["assignment_id"]},
        limit=1,
    )
    if not assignments:
        raise LookupError("Assignment not found")
    assignment_row = assignments[0]
    class_row = await _get_class(assignment_row["class_id"])
    if class_row is None:
        raise LookupError("Class not found")
    submission = await _submission_for_recipient(recipient_row["id"])
    result = await _result_for_submission(submission)
    return AssignmentRecipientDetail(
        recipient=AssignmentRecipient.model_validate(recipient_row),
        assignment=Assignment.model_validate(assignment_row),
        class_room=ClassRoom.model_validate(class_row),
        submission=AssignmentSubmission.model_validate(submission) if submission else None,
        result=result,
    )


async def list_user_assignments(*, user_id: str) -> list[AssignmentRecipientDetail]:
    recipients = await _select(_RECIPIENTS, filters={"user_id": user_id})
    recipients.sort(
        key=lambda row: (
            row.get("status") == "completed",
            row.get("created_at") or "",
        )
    )
    return [await _recipient_detail(row) for row in recipients]


async def get_assignment_detail(
    *,
    user_id: str,
    recipient_id: str,
) -> AssignmentRecipientDetail:
    rows = await _select(
        _RECIPIENTS,
        filters={"id": recipient_id, "user_id": user_id},
        limit=1,
    )
    if not rows:
        raise LookupError("Assignment not found")
    return await _recipient_detail(rows[0])


async def get_class_detail(*, user_id: str, class_id: str) -> ClassDetail:
    member = await _require_member(class_id, user_id)
    class_row = await _get_class(class_id)
    if class_row is None:
        raise LookupError("Class not found")
    roster = [
        ClassMember.model_validate(row)
        for row in await _select(_MEMBERS, filters={"class_id": class_id})
    ]
    assignments = await _select(
        _ASSIGNMENTS,
        filters={"class_id": class_id},
        order=("created_at", True),
    )
    if member.get("role") == "coach":
        summaries: list[CoachAssignmentSummary] = []
        for assignment in assignments:
            recipients = await _select(
                _RECIPIENTS,
                filters={"assignment_id": assignment["id"]},
            )
            submissions: list[AssignmentSubmission] = []
            results: dict[str, dict[str, Any]] = {}
            for recipient in recipients:
                submission = await _submission_for_recipient(recipient["id"])
                if submission:
                    submissions.append(AssignmentSubmission.model_validate(submission))
                    result = await _result_for_submission(submission)
                    if result is not None:
                        results[recipient["id"]] = result
            summaries.append(
                CoachAssignmentSummary(
                    assignment=Assignment.model_validate(assignment),
                    recipients=[AssignmentRecipient.model_validate(r) for r in recipients],
                    submissions=submissions,
                    results=results,
                )
            )
        visible_assignments: list[CoachAssignmentSummary | AssignmentRecipientDetail] = summaries
    else:
        own_recipients = [
            row
            for row in await _select(_RECIPIENTS, filters={"user_id": user_id})
            if row.get("assignment_id") in {a["id"] for a in assignments}
        ]
        visible_assignments = [await _recipient_detail(row) for row in own_recipients]
    return ClassDetail(
        class_room=ClassRoom.model_validate(class_row),
        role=member["role"],
        roster=roster,
        assignments=visible_assignments,
    )


async def start_assignment(*, user_id: str, recipient_id: str) -> StartAssignmentResponse:
    detail = await get_assignment_detail(user_id=user_id, recipient_id=recipient_id)
    recipient = detail.recipient
    assignment = detail.assignment
    patch: dict[str, Any] = {}
    if recipient.status == "assigned":
        patch = {"status": "in_progress", "started_at": _now_iso()}
        row = await _update(
            _RECIPIENTS,
            {"id": recipient_id, "user_id": user_id},
            patch,
        )
        recipient = AssignmentRecipient.model_validate(row)

    round_id: str | None = None
    if assignment.type == "practice_round":
        existing = await _submission_for_recipient(recipient_id)
        if existing and existing.get("round_id"):
            round_id = existing["round_id"]
        else:
            payload = PracticeRoundAssignmentPayload.model_validate(assignment.payload)
            round_row = await rounds_service.create_round(
                user_id=user_id,
                format=payload.format,
                topic=payload.topic,
                side=payload.side,
            )
            round_id = round_row.id
            await _insert(
                _SUBMISSIONS,
                {
                    "recipient_id": recipient_id,
                    "user_id": user_id,
                    "round_id": round_id,
                },
            )

    return StartAssignmentResponse(
        recipient=recipient,
        assignment=assignment,
        round_id=round_id,
    )


async def complete_assignment(
    *,
    user_id: str,
    recipient_id: str,
    drill_id: str | None = None,
    round_id: str | None = None,
) -> AssignmentRecipientDetail:
    detail = await get_assignment_detail(user_id=user_id, recipient_id=recipient_id)
    assignment = detail.assignment
    if assignment.type == "drill":
        if not drill_id or round_id:
            raise ValueError("Drill assignment requires drill_id")
        rows = await _select("drills", filters={"id": drill_id, "user_id": user_id}, limit=1)
        if not rows:
            raise PermissionError("Drill not found for current user")
        submission_payload = {"drill_id": drill_id}
    else:
        if not round_id or drill_id:
            raise ValueError("Practice assignment requires round_id")
        rows = await _select("rounds", filters={"id": round_id, "user_id": user_id}, limit=1)
        if not rows:
            raise PermissionError("Round not found for current user")
        submission_payload = {"round_id": round_id}

    existing = await _submission_for_recipient(recipient_id)
    if existing is None:
        await _insert(
            _SUBMISSIONS,
            {
                "recipient_id": recipient_id,
                "user_id": user_id,
                **submission_payload,
            },
        )
    elif any(existing.get(key) != value for key, value in submission_payload.items()):
        raise PermissionError("Assignment already has a different submission")
    await _update(
        _RECIPIENTS,
        {"id": recipient_id, "user_id": user_id},
        {"status": "completed", "completed_at": _now_iso()},
    )
    return await get_assignment_detail(user_id=user_id, recipient_id=recipient_id)
