"""Service for fetching per-student and class-level progress for coaches."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from models.coach_progress import ClassProgressResponse, StudentProgress
from models.drill import DrillSummary
from services import rounds as rounds_service
from services.classroom import _require_coach, _select
from services.supabase_client import get_supabase

_MEMBERS = "class_members"
_SUBMISSIONS = "assignment_submissions"
_ROUND_LIMIT = 100
_DRILL_LIMIT = 100
_DRILL_SUMMARY_COLUMNS = (
    "id,drill_type,prompt,score,numeric_score,duration_seconds,wpm,accuracy,"
    "completion,timer_seconds,created_at"
)


def _fetch_drill_rows(user_id: str, limit: int) -> list[dict[str, Any]]:
    """Synchronous helper — call via asyncio.to_thread."""
    sb = get_supabase()
    result = (
        sb.table("drills")
        .select(_DRILL_SUMMARY_COLUMNS)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(getattr(result, "data", None) or [])


def _row_to_drill_summary(row: dict[str, Any]) -> DrillSummary | None:
    """Convert a raw drill row to DrillSummary, returning None on missing data."""
    if row.get("prompt") is None:
        return None
    prompt_data = row.get("prompt") or {}
    if isinstance(prompt_data, str):
        try:
            prompt_data = json.loads(prompt_data)
        except Exception:
            prompt_data = {}
    score_data = row.get("score") or {}
    if isinstance(score_data, str):
        try:
            score_data = json.loads(score_data)
        except Exception:
            score_data = {}
    if not isinstance(prompt_data, dict):
        prompt_data = {}
    if not isinstance(score_data, dict):
        score_data = {}
    if row.get("numeric_score") is not None:
        score_data["score"] = row["numeric_score"]
    return DrillSummary(
        id=str(row["id"]),
        drill_type=row["drill_type"],
        prompt={"timer_seconds": prompt_data.get("timer_seconds")},
        score={
            key: score_data.get(key)
            for key in ("score", "duration_seconds")
            if score_data.get(key) is not None
        },
        numeric_score=row.get("numeric_score"),
        duration_seconds=row.get("duration_seconds"),
        wpm=row.get("wpm"),
        accuracy=row.get("accuracy"),
        completion=row.get("completion"),
        timer_seconds=row.get("timer_seconds"),
        created_at=row.get("created_at"),
    )


async def class_progress(coach_id: str, class_id: str) -> ClassProgressResponse:
    """Require coach role, then gather progress for every competitor in the class."""
    await _require_coach(class_id, coach_id)

    member_rows = await _select(_MEMBERS, filters={"class_id": class_id})
    competitor_ids = [
        row["user_id"]
        for row in member_rows
        if row.get("role") == "competitor"
    ]

    submission_rows = await _select(_SUBMISSIONS)
    round_to_recipient = {
        row["round_id"]: row["recipient_id"]
        for row in submission_rows
        if row.get("round_id") and row.get("recipient_id")
    }

    async def _student_progress(user_id: str) -> StudentProgress:
        rounds_task = rounds_service.list_round_summaries(
            user_id=user_id,
            limit=_ROUND_LIMIT,
        )
        drill_rows_task = asyncio.to_thread(_fetch_drill_rows, user_id, _DRILL_LIMIT)
        rounds, drill_rows = await asyncio.gather(rounds_task, drill_rows_task)
        rounds = [
            round_summary.model_copy(
                update={"recipient_id": round_to_recipient.get(round_summary.id)}
            )
            for round_summary in rounds
        ]
        drills = [
            s
            for row in drill_rows
            if (s := _row_to_drill_summary(row)) is not None
        ]
        return StudentProgress(user_id=user_id, rounds=rounds, drills=drills)

    students = await asyncio.gather(*(_student_progress(uid) for uid in competitor_ids))
    return ClassProgressResponse(students=list(students))
