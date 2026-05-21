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

    try:  # Prefer the shared wrapper if A4 has landed it.
        from services.supabase_client import get_service_client  # type: ignore

        _supabase_client = get_service_client()
        return _supabase_client
    except ImportError:
        pass

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
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


# ---------------------------------------------------------------------------
# Tiny LRU-style cache keyed on `target_words`.
# `functools.lru_cache` doesn't play well with coroutines, so we keep a
# small hand-rolled dict with FIFO eviction — good enough for a handful
# of distinct target word counts.
# ---------------------------------------------------------------------------

_CACHE_MAXSIZE = 32
_passage_cache: dict[int, str | None] = {}


def clear_cache() -> None:
    _passage_cache.clear()


def _cache_set(key: int, value: str | None) -> None:
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


async def get_passage(target_words: int) -> str | None:
    """Return the passage whose `target_words` is closest to the request.

    Results are memoised per `target_words` value.
    """

    if target_words in _passage_cache:
        return _passage_cache[target_words]

    client = _get_service_client()

    def _query() -> list[dict[str, Any]]:
        # Pull every row (the table is tiny) and pick the closest match
        # in Python — PostgREST can't order by `abs(col - $1)` directly.
        response = (
            client.table("speed_passages")
            .select("id, target_words, text")
            .execute()
        )
        return getattr(response, "data", None) or []

    rows = await asyncio.to_thread(_query)
    if not rows:
        _cache_set(target_words, None)
        return None

    best = min(rows, key=lambda r: abs(int(r["target_words"]) - target_words))
    text = best.get("text")
    _cache_set(target_words, text)
    return text


async def list_passages() -> list[Passage]:
    """Admin/debug helper — returns every seeded passage."""

    client = _get_service_client()

    def _query() -> list[dict[str, Any]]:
        response = (
            client.table("speed_passages")
            .select("id, target_words, text")
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
        )
        for row in rows
    ]
