"""Persisted case-analysis feedback for classroom submissions."""

from __future__ import annotations

import asyncio
from typing import Any

from models.case_review import CaseReview
from services.supabase_client import get_supabase

_TABLE = "case_reviews"


def _client():
    return get_supabase()


async def create_case_review(
    *,
    user_id: str,
    format: str,
    topic: str,
    side: str,
    source_text: str,
    score: int,
    category: str,
    summary: str,
    feedback: str,
) -> CaseReview:
    payload = {
        "user_id": user_id,
        "format": format,
        "topic": topic,
        "side": side,
        "source_text": source_text,
        "score": score,
        "category": category,
        "summary": summary,
        "feedback": feedback,
    }

    def _do() -> dict[str, Any]:
        resp = _client().table(_TABLE).insert(payload).execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError("case_reviews insert returned no rows")
        return data[0]

    row = await asyncio.to_thread(_do)
    return CaseReview.model_validate(row)


async def get_case_review(*, user_id: str, case_review_id: str) -> CaseReview | None:
    def _do() -> dict[str, Any] | None:
        resp = (
            _client()
            .table(_TABLE)
            .select("*")
            .eq("id", case_review_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    row = await asyncio.to_thread(_do)
    return CaseReview.model_validate(row) if row else None
