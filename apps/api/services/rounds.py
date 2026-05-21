"""Rounds CRUD over the Supabase ``rounds`` table.

Every query is scoped by ``user_id`` so we're never relying on RLS alone.
The Supabase Python SDK is sync, so calls are dispatched to a worker thread
via ``asyncio.to_thread``.
"""

from __future__ import annotations

import asyncio
from typing import Any

from models.round import Round
from services.supabase_client import get_supabase

_TABLE = "rounds"


def _row_to_round(row: dict[str, Any]) -> Round:
    return Round.model_validate(row)


async def create_round(
    user_id: str, format: str, topic: str, side: str
) -> Round:
    client = get_supabase()
    payload = {
        "user_id": user_id,
        "format": format,
        "topic": topic,
        "side": side,
    }

    def _do() -> dict[str, Any]:
        resp = client.table(_TABLE).insert(payload).execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError("Supabase insert returned no rows")
        return data[0]

    row = await asyncio.to_thread(_do)
    return _row_to_round(row)


async def list_rounds(user_id: str, limit: int = 25) -> list[Round]:
    client = get_supabase()

    def _do() -> list[dict[str, Any]]:
        resp = (
            client.table(_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return list(getattr(resp, "data", None) or [])

    rows = await asyncio.to_thread(_do)
    return [_row_to_round(r) for r in rows]


async def get_round(user_id: str, round_id: str) -> Round | None:
    client = get_supabase()

    def _do() -> dict[str, Any] | None:
        resp = (
            client.table(_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("id", round_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    row = await asyncio.to_thread(_do)
    return _row_to_round(row) if row else None


async def update_round(
    user_id: str, round_id: str, fields: dict[str, Any]
) -> Round:
    if not fields:
        raise ValueError("update_round requires at least one field")
    client = get_supabase()

    def _do() -> dict[str, Any]:
        resp = (
            client.table(_TABLE)
            .update(fields)
            .eq("user_id", user_id)
            .eq("id", round_id)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError("Supabase update returned no rows")
        return data[0]

    row = await asyncio.to_thread(_do)
    return _row_to_round(row)
