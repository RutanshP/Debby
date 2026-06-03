"""Comment routes: GET /api/comments, POST /api/comments, DELETE /api/comments/{id}."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from deps.auth import User, get_current_user
from models.comments import Comment, CreateCommentRequest
from services import comments as comments_service

router = APIRouter(tags=["comments"])


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/comments", response_model=list[Comment])
async def list_comments_route(
    target_type: str,
    target_id: str,
    user: User = Depends(get_current_user),
) -> list[Comment]:
    try:
        return await comments_service.list_comments(
            user_id=user.id,
            target_type=target_type,
            target_id=target_id,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/comments", response_model=Comment)
async def create_comment_route(
    body: CreateCommentRequest,
    user: User = Depends(get_current_user),
) -> Comment:
    try:
        return await comments_service.create_comment(user_id=user.id, req=body)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment_route(
    comment_id: str,
    user: User = Depends(get_current_user),
) -> None:
    try:
        await comments_service.delete_comment(user_id=user.id, comment_id=comment_id)
    except Exception as exc:
        raise _translate_error(exc) from exc
