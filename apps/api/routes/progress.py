"""Compact progress dashboard API."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from deps.auth import User, get_current_user
from models.progress import ProgressSummary
from routes.drills import _list_drill_summaries, _row_to_drill_summary
from services import insights as insights_service
from services import rounds as rounds_service

router = APIRouter(tags=["progress"])


@router.get("/progress/summary", response_model=ProgressSummary)
async def progress_summary_route(
    round_limit: int = 100,
    drill_limit: int = 100,
    user: User = Depends(get_current_user),
) -> ProgressSummary:
    round_limit = max(1, min(round_limit, 100))
    drill_limit = max(1, min(drill_limit, 200))

    rounds_task = rounds_service.list_round_summaries(
        user_id=user.id,
        limit=round_limit,
    )
    drill_rows_task = asyncio.to_thread(
        _list_drill_summaries,
        user.id,
        drill_limit,
    )
    insights_task = insights_service.get_cached_insights(user.id)

    rounds, drill_rows, insights = await asyncio.gather(
        rounds_task,
        drill_rows_task,
        insights_task,
    )
    drill_summaries = [_row_to_drill_summary(row) for row in drill_rows]

    return ProgressSummary(
        rounds=rounds,
        drills=[summary for summary in drill_summaries if summary is not None],
        insights=insights,
    )
