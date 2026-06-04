"""Coach submission viewer routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from deps.auth import User, get_current_user
from models.coach_view import CoachSubmissionResponse
from services import coach_view as coach_view_service

router = APIRouter(tags=["coach_submissions"])


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get(
    "/classes/{class_id}/recipients/{recipient_id}/submission",
    response_model=CoachSubmissionResponse,
)
async def get_coach_submission(
    class_id: str,
    recipient_id: str,
    user: User = Depends(get_current_user),
) -> CoachSubmissionResponse:
    try:
        payload = await coach_view_service.get_submission_for_coach(
            coach_id=user.id,
            class_id=class_id,
            recipient_id=recipient_id,
        )
        return CoachSubmissionResponse(**payload)
    except Exception as exc:
        raise _translate_error(exc) from exc
