"""Coach progress dashboard routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from routes._errors import translate_error as _translate_error

from deps.auth import User, get_current_user
from models.coach_progress import ClassProgressResponse
from services import coach_progress as coach_progress_service

router = APIRouter(tags=["coach_progress"])



@router.get("/classes/{class_id}/progress", response_model=ClassProgressResponse)
async def class_progress_route(
    class_id: str,
    user: User = Depends(get_current_user),
) -> ClassProgressResponse:
    try:
        return await coach_progress_service.class_progress(
            coach_id=user.id,
            class_id=class_id,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc
