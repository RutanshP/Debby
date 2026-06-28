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
    CaseAssignmentPayload,
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


async def _select_in(
    table: str,
    *,
    field: str,
    values: list[Any],
    order: tuple[str, bool] | None = None,
) -> list[dict[str, Any]]:
    if not values:
        return []

    client = _client()

    def _do() -> list[dict[str, Any]]:
        query = client.table(table).select("*").in_(field, values)
        if order:
            query = query.order(order[0], desc=order[1])
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


def _sort_timestamp_desc(value: Any) -> float:
    if not value:
        return float("-inf")
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return float("-inf")


def _is_jwt_future_error(exc: Exception) -> bool:
    message = str(exc)
    return "JWT issued at future" in message or "PGRST303" in message


def _validate_payload(kind: AssignmentType, payload: dict[str, Any]) -> dict[str, Any]:
    if kind == "drill":
        return DrillAssignmentPayload.model_validate(payload).model_dump()
    if kind == "case":
        return CaseAssignmentPayload.model_validate(payload).model_dump()
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
    class_ids = [
        membership["class_id"]
        for membership in memberships
        if isinstance(membership.get("class_id"), str)
    ]
    class_rows = await _select_in(_CLASSES, field="id", values=class_ids) if class_ids else []
    class_rows_by_id = {row["id"]: row for row in class_rows}
    recipients = await _select(_RECIPIENTS, filters={"user_id": user_id})
    assignment_ids = [
        recipient["assignment_id"]
        for recipient in recipients
        if isinstance(recipient.get("assignment_id"), str)
    ]
    assignment_rows = (
        await _select_in(_ASSIGNMENTS, field="id", values=assignment_ids)
        if assignment_ids
        else []
    )
    assignment_class_by_id = {
        row["id"]: row["class_id"]
        for row in assignment_rows
        if isinstance(row.get("class_id"), str)
    }
    open_counts_by_class: dict[str, int] = {}
    for recipient in recipients:
        assignment_id = recipient.get("assignment_id")
        class_id = assignment_class_by_id.get(assignment_id)
        if class_id and recipient.get("status") != "completed":
            open_counts_by_class[class_id] = open_counts_by_class.get(class_id, 0) + 1

    items: list[ClassListItem] = []
    for membership in memberships:
        class_row = class_rows_by_id.get(membership["class_id"])
        if class_row is None:
            continue
        open_count = (
            open_counts_by_class.get(class_row["id"], 0)
            if membership.get("role") == "competitor"
            else 0
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
    if request.instructions and request.instructions.strip():
        payload["instructions"] = request.instructions.strip()

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
    if submission.get("case_review_id"):
        rows = await _select(
            "case_reviews",
            filters={"id": submission["case_review_id"], "user_id": submission["user_id"]},
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


async def _latest_submissions_for_recipients(
    recipient_ids: list[str],
) -> dict[str, dict[str, Any]]:
    rows = await _select_in(
        _SUBMISSIONS,
        field="recipient_id",
        values=recipient_ids,
        order=("created_at", True),
    )
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        recipient_id = row.get("recipient_id")
        if isinstance(recipient_id, str) and recipient_id not in latest:
            latest[recipient_id] = row
    return latest


async def _results_for_submissions(
    submissions_by_recipient: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    drill_ids = [row["drill_id"] for row in submissions_by_recipient.values() if row.get("drill_id")]
    round_ids = [row["round_id"] for row in submissions_by_recipient.values() if row.get("round_id")]
    case_review_ids = [
        row["case_review_id"]
        for row in submissions_by_recipient.values()
        if row.get("case_review_id")
    ]

    drill_rows = await _select_in("drills", field="id", values=drill_ids) if drill_ids else []
    round_rows = await _select_in("rounds", field="id", values=round_ids) if round_ids else []
    case_review_rows = (
        await _select_in("case_reviews", field="id", values=case_review_ids)
        if case_review_ids
        else []
    )

    drill_by_id = {row["id"]: row for row in drill_rows}
    round_by_id = {row["id"]: row for row in round_rows}
    case_review_by_id = {row["id"]: row for row in case_review_rows}

    results: dict[str, dict[str, Any]] = {}
    for recipient_id, submission in submissions_by_recipient.items():
        if submission.get("drill_id") and submission["drill_id"] in drill_by_id:
            results[recipient_id] = drill_by_id[submission["drill_id"]]
        elif submission.get("round_id") and submission["round_id"] in round_by_id:
            results[recipient_id] = round_by_id[submission["round_id"]]
        elif (
            submission.get("case_review_id")
            and submission["case_review_id"] in case_review_by_id
        ):
            results[recipient_id] = case_review_by_id[submission["case_review_id"]]
    return results


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
    try:
        recipients = await _select(_RECIPIENTS, filters={"user_id": user_id})
    except Exception as exc:
        if _is_jwt_future_error(exc):
            return []
        raise
    recipients.sort(
        key=lambda row: (
            row.get("status") == "completed",
            -_sort_timestamp_desc(row.get("created_at")),
        ),
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
    assignment_ids = [assignment["id"] for assignment in assignments]
    recipient_rows = (
        await _select_in(_RECIPIENTS, field="assignment_id", values=assignment_ids)
        if assignment_ids
        else []
    )
    recipients_by_assignment: dict[str, list[dict[str, Any]]] = {}
    for row in recipient_rows:
        assignment_id = row.get("assignment_id")
        if isinstance(assignment_id, str):
            recipients_by_assignment.setdefault(assignment_id, []).append(row)
    latest_submissions_by_recipient = await _latest_submissions_for_recipients(
        [row["id"] for row in recipient_rows if isinstance(row.get("id"), str)]
    )
    results_by_recipient = await _results_for_submissions(latest_submissions_by_recipient)
    if member.get("role") == "coach":
        summaries: list[CoachAssignmentSummary] = []
        for assignment in assignments:
            recipients = recipients_by_assignment.get(assignment["id"], [])
            submissions: list[AssignmentSubmission] = []
            results: dict[str, dict[str, Any]] = {}
            for recipient in recipients:
                submission = latest_submissions_by_recipient.get(recipient["id"])
                if submission:
                    submissions.append(AssignmentSubmission.model_validate(submission))
                    result = results_by_recipient.get(recipient["id"])
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
        own_recipients = [row for row in recipient_rows if row.get("user_id") == user_id]
        assignment_rows_by_id = {assignment["id"]: assignment for assignment in assignments}
        own_recipients.sort(
            key=lambda row: -_sort_timestamp_desc(
                assignment_rows_by_id.get(row.get("assignment_id"), {}).get("created_at")
            )
        )
        visible_assignments = [
            AssignmentRecipientDetail(
                recipient=AssignmentRecipient.model_validate(row),
                assignment=Assignment.model_validate(assignment_rows_by_id[row["assignment_id"]]),
                class_room=ClassRoom.model_validate(class_row),
                submission=(
                    AssignmentSubmission.model_validate(
                        latest_submissions_by_recipient[row["id"]]
                    )
                    if row["id"] in latest_submissions_by_recipient
                    else None
                ),
                result=results_by_recipient.get(row["id"]),
            )
            for row in own_recipients
        ]
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
    case_review_id: str | None = None,
) -> AssignmentRecipientDetail:
    detail = await get_assignment_detail(user_id=user_id, recipient_id=recipient_id)
    assignment = detail.assignment
    if assignment.type == "drill":
        if not drill_id or round_id or case_review_id:
            raise ValueError("Drill assignment requires drill_id")
        rows = await _select("drills", filters={"id": drill_id, "user_id": user_id}, limit=1)
        if not rows:
            raise PermissionError("Drill not found for current user")
        submission_payload = {"drill_id": drill_id}
    elif assignment.type == "case":
        if not case_review_id or drill_id or round_id:
            raise ValueError("Case assignment requires case_review_id")
        rows = await _select(
            "case_reviews",
            filters={"id": case_review_id, "user_id": user_id},
            limit=1,
        )
        if not rows:
            raise PermissionError("Case review not found for current user")
        submission_payload = {"case_review_id": case_review_id}
    else:
        if not round_id or drill_id or case_review_id:
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


async def complete_matching_drill_assignment(
    *,
    user_id: str,
    drill_id: str,
) -> AssignmentRecipientDetail | None:
    drill_rows = await _select("drills", filters={"id": drill_id, "user_id": user_id}, limit=1)
    if not drill_rows:
        raise PermissionError("Drill not found for current user")

    drill_row = drill_rows[0]
    drill_type = drill_row.get("drill_type")
    timer_seconds = drill_row.get("timer_seconds")
    if not drill_type or timer_seconds is None:
        return None

    recipients = await _select(_RECIPIENTS, filters={"user_id": user_id})
    open_recipients = [
        row
        for row in recipients
        if row.get("status") != "completed"
    ]
    open_recipients.sort(key=lambda row: row.get("created_at") or "")

    for recipient_row in open_recipients:
        existing_submission = await _submission_for_recipient(recipient_row["id"])
        if existing_submission is not None:
            continue

        assignment_rows = await _select(
            _ASSIGNMENTS,
            filters={"id": recipient_row["assignment_id"], "type": "drill"},
            limit=1,
        )
        if not assignment_rows:
            continue

        assignment_row = assignment_rows[0]
        payload = assignment_row.get("payload") or {}
        if not isinstance(payload, dict):
            continue
        if payload.get("drill_type") != drill_type:
            continue
        if payload.get("timer_seconds") != timer_seconds:
            continue

        return await complete_assignment(
            user_id=user_id,
            recipient_id=recipient_row["id"],
            drill_id=drill_id,
        )

    return None
