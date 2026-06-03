"""Comment persistence over Supabase."""

from __future__ import annotations

import asyncio
from typing import Any

from models.comments import Comment, CreateCommentRequest
from services.classroom import _require_member, _get_member
from services.supabase_client import get_supabase

_COMMENTS = "comments"
_MEMBERS = "class_members"


def _client() -> Any:
    return get_supabase()


async def _get_comment_by_id(comment_id: str) -> dict[str, Any] | None:
    client = _client()

    def _do() -> dict[str, Any] | None:
        resp = client.table(_COMMENTS).select("*").eq("id", comment_id).limit(1).execute()
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    return await asyncio.to_thread(_do)


async def list_comments(
    *,
    user_id: str,
    target_type: str,
    target_id: str,
) -> list[Comment]:
    """List comments for a target.

    Requires that the user is a member of at least one class that owns the
    target.  Private comments are filtered: a student sees only their own
    private comments plus all public ones; a coach sees everything.
    """
    client = _client()

    # Fetch all comments for this target (across all classes).
    def _fetch_comments() -> list[dict[str, Any]]:
        resp = (
            client.table(_COMMENTS)
            .select("*")
            .eq("target_type", target_type)
            .eq("target_id", target_id)
            .order("created_at", desc=False)
            .execute()
        )
        return list(getattr(resp, "data", None) or [])

    rows = await asyncio.to_thread(_fetch_comments)
    if not rows:
        return []

    # Collect unique class_ids referenced by these comments.
    class_ids = {row["class_id"] for row in rows}

    # Check membership for each class and determine role.
    coach_class_ids: set[str] = set()
    member_class_ids: set[str] = set()
    for class_id in class_ids:
        member = await _get_member(class_id, user_id)
        if member is not None:
            member_class_ids.add(class_id)
            if member.get("role") == "coach":
                coach_class_ids.add(class_id)

    if not member_class_ids:
        raise PermissionError("Not a class member")

    # Filter visibility.
    visible: list[Comment] = []
    for row in rows:
        cid = row["class_id"]
        if cid not in member_class_ids:
            # Comment belongs to a class the user is not in — skip.
            continue
        if row.get("is_private"):
            # Private: only author or coach can see.
            if row["author_id"] != user_id and cid not in coach_class_ids:
                continue
        visible.append(Comment.model_validate(row))

    return visible


async def create_comment(*, user_id: str, req: CreateCommentRequest) -> Comment:
    """Create a comment; requires class membership."""
    await _require_member(req.class_id, user_id)

    client = _client()

    def _do() -> dict[str, Any]:
        resp = (
            client.table(_COMMENTS)
            .insert(
                {
                    "class_id": req.class_id,
                    "target_type": req.target_type,
                    "target_id": req.target_id,
                    "author_id": user_id,
                    "body": req.body.strip(),
                    "is_private": req.is_private,
                }
            )
            .execute()
        )
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError("comments insert returned no rows")
        return data[0]

    row = await asyncio.to_thread(_do)
    return Comment.model_validate(row)


async def delete_comment(*, user_id: str, comment_id: str) -> None:
    """Delete a comment; author or a coach of the comment's class may delete."""
    row = await _get_comment_by_id(comment_id)
    if row is None:
        raise LookupError("Comment not found")

    class_id = row["class_id"]
    author_id = row["author_id"]

    if author_id != user_id:
        # Check if the caller is a coach in the comment's class.
        member = await _get_member(class_id, user_id)
        if member is None or member.get("role") != "coach":
            raise PermissionError("Only the author or a coach can delete this comment")

    client = _client()

    def _do() -> None:
        client.table(_COMMENTS).delete().eq("id", comment_id).execute()

    await asyncio.to_thread(_do)
