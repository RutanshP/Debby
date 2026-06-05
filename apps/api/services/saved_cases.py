"""Saved Case Studio outputs stored in Supabase."""

from __future__ import annotations

import asyncio
from typing import Any

from models.saved_case import SavedCase, SavedCaseSummary
from services.supabase_client import get_supabase

_TABLE = "saved_cases"
_SUMMARY_COLUMNS = "id,title,topic,format,side,created_at,updated_at"


def _row_to_saved_case(row: dict[str, Any]) -> SavedCase:
    return SavedCase.model_validate(row)


def _row_to_summary(row: dict[str, Any]) -> SavedCaseSummary:
    return SavedCaseSummary.model_validate(row)


async def create_saved_case(
    *,
    user_id: str,
    title: str,
    topic: str,
    format: str,
    side: str,
    content: str,
) -> SavedCase:
    client = get_supabase()
    payload = {
        "user_id": user_id,
        "title": title.strip(),
        "topic": topic.strip(),
        "format": format,
        "side": side,
        "content": content.strip(),
    }

    def _do() -> dict[str, Any]:
        resp = client.table(_TABLE).insert(payload).execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError("Supabase insert returned no rows")
        return data[0]

    row = await asyncio.to_thread(_do)
    return _row_to_saved_case(row)


async def list_saved_cases(
    *, user_id: str, limit: int = 25, offset: int = 0
) -> list[SavedCaseSummary]:
    client = get_supabase()
    offset = max(offset, 0)

    def _do() -> list[dict[str, Any]]:
        resp = (
            client.table(_TABLE)
            .select(_SUMMARY_COLUMNS)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return list(getattr(resp, "data", None) or [])

    rows = await asyncio.to_thread(_do)
    return [_row_to_summary(row) for row in rows]


async def get_saved_case(*, user_id: str, case_id: str) -> SavedCase | None:
    client = get_supabase()

    def _do() -> dict[str, Any] | None:
        resp = (
            client.table(_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("id", case_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    row = await asyncio.to_thread(_do)
    return _row_to_saved_case(row) if row else None


async def delete_saved_case(*, user_id: str, case_id: str) -> bool:
    existing = await get_saved_case(user_id=user_id, case_id=case_id)
    if existing is None:
        return False

    client = get_supabase()

    def _do() -> None:
        (
            client.table(_TABLE)
            .delete()
            .eq("user_id", user_id)
            .eq("id", case_id)
            .execute()
        )

    await asyncio.to_thread(_do)
    return True
