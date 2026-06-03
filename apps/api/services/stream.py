"""Stream service: class posts (announcements and materials)."""

from __future__ import annotations

import asyncio
from typing import Any

from models.stream import ClassPost, CreatePostRequest
from services.classroom import _require_coach, _require_member
from services.supabase_client import get_supabase

_POSTS = "class_posts"


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


async def _insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = _client()

    def _do() -> dict[str, Any]:
        resp = client.table(table).insert(payload).execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError(f"{table} insert returned no rows")
        return data[0]

    return await asyncio.to_thread(_do)


async def _delete(table: str, filters: dict[str, Any]) -> None:
    client = _client()

    def _do() -> None:
        query = client.table(table).delete()
        for key, value in filters.items():
            query = query.eq(key, value)
        query.execute()

    await asyncio.to_thread(_do)


async def list_posts(user_id: str, class_id: str) -> list[ClassPost]:
    """Return all posts for a class. Requires membership."""
    await _require_member(class_id, user_id)
    rows = await _select(
        _POSTS,
        filters={"class_id": class_id},
        order=("created_at", True),
    )
    return [ClassPost.model_validate(row) for row in rows]


async def create_post(
    user_id: str,
    class_id: str,
    req: CreatePostRequest,
) -> ClassPost:
    """Create a post in a class. Requires coach role."""
    await _require_coach(class_id, user_id)
    row = await _insert(
        _POSTS,
        {
            "class_id": class_id,
            "author_id": user_id,
            "type": req.type,
            "title": req.title,
            "body": req.body,
            "link_url": req.link_url,
        },
    )
    return ClassPost.model_validate(row)


async def delete_post(user_id: str, class_id: str, post_id: str) -> None:
    """Delete a post. Requires coach role OR being the author."""
    # Confirm the post belongs to this class and exists.
    rows = await _select(_POSTS, filters={"id": post_id, "class_id": class_id}, limit=1)
    if not rows:
        raise LookupError("Post not found")

    post = rows[0]
    # Verify the user is still a member of the class before any deletion.
    await _require_member(class_id, user_id)
    # Allow if the user is the author.
    if post.get("author_id") == user_id:
        await _delete(_POSTS, {"id": post_id})
        return

    # Otherwise they must be a coach.
    await _require_coach(class_id, user_id)
    await _delete(_POSTS, {"id": post_id})
