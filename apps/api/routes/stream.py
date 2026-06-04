"""Stream routes: class posts (announcements and materials)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from routes._errors import translate_error as _translate_error

from deps.auth import User, get_current_user
from models.stream import ClassPost, CreatePostRequest
from services import stream as stream_service

router = APIRouter(tags=["stream"])



@router.get("/classes/{class_id}/posts", response_model=list[ClassPost])
async def list_posts_route(
    class_id: str,
    user: User = Depends(get_current_user),
) -> list[ClassPost]:
    try:
        return await stream_service.list_posts(user.id, class_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/classes/{class_id}/posts", response_model=ClassPost)
async def create_post_route(
    class_id: str,
    body: CreatePostRequest,
    user: User = Depends(get_current_user),
) -> ClassPost:
    try:
        return await stream_service.create_post(user.id, class_id, body)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.delete("/classes/{class_id}/posts/{post_id}", status_code=204)
async def delete_post_route(
    class_id: str,
    post_id: str,
    user: User = Depends(get_current_user),
) -> None:
    try:
        await stream_service.delete_post(user.id, class_id, post_id)
    except Exception as exc:
        raise _translate_error(exc) from exc
