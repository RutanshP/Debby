"""Profile persistence over Supabase."""

from __future__ import annotations

import asyncio
from typing import Any

from services.supabase_client import get_supabase

_PROFILES = "profiles"


def _client():
    return get_supabase()


async def _select(
    table: str,
    *,
    filters: dict[str, Any] | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    client = _client()

    def _do() -> list[dict[str, Any]]:
        query = client.table(table).select("*")
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        if limit is not None:
            query = query.limit(limit)
        resp = query.execute()
        return list(getattr(resp, "data", None) or [])

    return await asyncio.to_thread(_do)


async def _upsert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = _client()

    def _do() -> dict[str, Any]:
        resp = client.table(table).upsert(payload).execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError(f"{table} upsert returned no rows")
        return data[0]

    return await asyncio.to_thread(_do)


async def get_profile(user_id: str) -> dict[str, Any] | None:
    """Return the profile row for `user_id`, or None if not found."""
    rows = await _select(_PROFILES, filters={"user_id": user_id}, limit=1)
    return rows[0] if rows else None


async def upsert_profile(user_id: str, display_name: str) -> dict[str, Any]:
    """Create or update the profile for `user_id`."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    row = await _upsert(
        _PROFILES,
        {
            "user_id": user_id,
            "display_name": display_name,
            "updated_at": now,
        },
    )
    return row


async def lookup_names(user_ids: list[str]) -> dict[str, str]:
    """Return a mapping of user_id -> display_name for known profiles.

    Unknown user_ids are omitted from the result.
    """
    if not user_ids:
        return {}

    client = _client()

    def _do() -> list[dict[str, Any]]:
        resp = (
            client.table(_PROFILES)
            .select("user_id,display_name")
            .in_("user_id", user_ids)
            .execute()
        )
        return list(getattr(resp, "data", None) or [])

    rows = await asyncio.to_thread(_do)
    return {
        row["user_id"]: row["display_name"]
        for row in rows
        if row.get("display_name") is not None
    }
