"""Profile persistence over Supabase."""

from __future__ import annotations

import asyncio
from typing import Any

from services.supabase_client import get_supabase

_PROFILES = "profiles"
_MEMBERS = "class_members"


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


async def _classmate_ids(user_id: str) -> set[str]:
    """Return the set of user_ids that share at least one class with `user_id`.

    Always includes `user_id` itself so callers can resolve their own name.
    """
    memberships = await _select(_MEMBERS, filters={"user_id": user_id})
    class_ids = {m["class_id"] for m in memberships if m.get("class_id")}
    allowed: set[str] = {user_id}
    for class_id in class_ids:
        for member in await _select(_MEMBERS, filters={"class_id": class_id}):
            member_id = member.get("user_id")
            if member_id:
                allowed.add(member_id)
    return allowed


async def lookup_names(user_ids: list[str], requester_id: str) -> dict[str, str]:
    """Return a mapping of user_id -> display_name for known profiles.

    Only user_ids that share a class with `requester_id` (or the requester
    themselves) are resolved; other ids and unknown ids are omitted. This
    mirrors the "profiles: classmates read" RLS policy at the application
    layer, since the service-role client bypasses RLS.
    """
    if not user_ids:
        return {}

    allowed = await _classmate_ids(requester_id)
    user_ids = [uid for uid in user_ids if uid in allowed]
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
