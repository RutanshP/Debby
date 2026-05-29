"""Lookup service for the seeded `public.speed_passages` table.

A4 owns the canonical Supabase client wrapper. To keep this unit
self-contained we lazily import (or, if missing, build) a service-role
client here. Routes never touch the service-role key directly.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any


# ---------------------------------------------------------------------------
# Supabase service-role client (lazy, single instance).
# ---------------------------------------------------------------------------

_supabase_client: Any | None = None


def _get_service_client() -> Any:
    """Return a cached Supabase client built with the service-role key.

    Falls back to a tiny inline factory if A4's wrapper isn't on disk yet.
    """

    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    try:  # Prefer the shared wrapper.
        from services.supabase_client import get_supabase

        _supabase_client = get_supabase()
        return _supabase_client
    except ImportError:
        pass

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SECRET_KEY must be set "
            "to query speed_passages."
        )

    from supabase import create_client  # local import so tests can monkeypatch

    _supabase_client = create_client(url, key)
    return _supabase_client


def _reset_client_for_tests() -> None:
    """Clear the memoised client (used by the test suite)."""

    global _supabase_client
    _supabase_client = None


# ---------------------------------------------------------------------------
# Public data model.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Passage:
    id: str
    target_words: int
    text: str
    category: str | None = None
    subtopic: str | None = None


# ---------------------------------------------------------------------------
# Tiny LRU-style cache keyed on `target_words`.
# `functools.lru_cache` doesn't play well with coroutines, so we keep a
# small hand-rolled dict with FIFO eviction — good enough for a handful
# of distinct target word counts.
# ---------------------------------------------------------------------------

_CACHE_MAXSIZE = 32
_passage_cache: dict[tuple[int, str | None], str | None] = {}


def clear_cache() -> None:
    _passage_cache.clear()


def _cache_set(key: tuple[int, str | None], value: str | None) -> None:
    if key in _passage_cache:
        return
    if len(_passage_cache) >= _CACHE_MAXSIZE:
        # Evict the oldest insertion (dicts preserve insertion order).
        oldest = next(iter(_passage_cache))
        _passage_cache.pop(oldest, None)
    _passage_cache[key] = value


# ---------------------------------------------------------------------------
# Public API.
# ---------------------------------------------------------------------------


async def get_passage(target_words: int, category: str | None = None) -> str | None:
    """Return the passage whose `target_words` is closest to the request.

    Results are memoised per `target_words` value.
    """

    cache_key = (target_words, category)
    if cache_key in _passage_cache:
        return _passage_cache[cache_key]

    client = _get_service_client()

    def _query() -> list[dict[str, Any]]:
        # Pull every row (the table is tiny) and pick the closest match
        # in Python — PostgREST can't order by `abs(col - $1)` directly.
        response = (
            client.table("speed_passages")
            .select("id, target_words, text, category")
            .execute()
        )
        rows = getattr(response, "data", None) or []
        if category:
            rows = [row for row in rows if row.get("category") == category]
        return rows

    rows = await asyncio.to_thread(_query)
    if not rows:
        _cache_set(cache_key, None)
        return None

    best = min(rows, key=lambda r: abs(int(r["target_words"]) - target_words))
    text = best.get("text")
    _cache_set(cache_key, text)
    return text


async def count_passages(category: str | None = None) -> int:
    """Return the number of stored speed passages."""

    client = _get_service_client()

    def _query() -> list[dict[str, Any]]:
        response = client.table("speed_passages").select("id, category").execute()
        return getattr(response, "data", None) or []

    rows = await asyncio.to_thread(_query)
    if category:
        rows = [
            row
            for row in rows
            if row.get("category") == category
            or (category == "debate" and not row.get("category"))
        ]
    return len(rows)


async def save_passage(
    target_words: int,
    text: str,
    category: str | None = None,
    subtopic: str | None = None,
) -> bool:
    """Store a generated passage if it is non-empty and not already present."""

    text = (text or "").strip()
    if not text:
        return False

    client = _get_service_client()

    def _insert() -> bool:
        existing = (
            client.table("speed_passages")
            .select("id")
            .eq("text", text)
            .limit(1)
            .execute()
        )
        if getattr(existing, "data", None):
            return False

        payload: dict[str, Any] = {"target_words": int(target_words), "text": text}
        if category:
            payload["category"] = category
        if subtopic:
            payload["subtopic"] = subtopic

        client.table("speed_passages").insert(payload).execute()
        return True

    inserted = await asyncio.to_thread(_insert)
    if inserted:
        clear_cache()
    return inserted


async def list_passages() -> list[Passage]:
    """Admin/debug helper — returns every seeded passage."""

    client = _get_service_client()

    def _query() -> list[dict[str, Any]]:
        response = (
            client.table("speed_passages")
            .select("id, target_words, text, category, subtopic")
            .order("target_words")
            .execute()
        )
        return getattr(response, "data", None) or []

    rows = await asyncio.to_thread(_query)
    return [
        Passage(
            id=str(row["id"]),
            target_words=int(row["target_words"]),
            text=str(row["text"]),
            category=row.get("category"),
            subtopic=row.get("subtopic"),
        )
        for row in rows
    ]
