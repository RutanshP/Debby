"""Coach progress dashboard routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from deps.auth import User, get_current_user
from models.coach_progress import ClassProgressResponse
from services import coach_progress as coach_progress_service

router = APIRouter(tags=["coach_progress"])


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


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
