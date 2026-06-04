"""Coach submission viewer routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from routes._errors import translate_error as _translate_error

from deps.auth import User, get_current_user
from models.coach_view import CoachSubmissionResponse
from services import coach_view as coach_view_service

router = APIRouter(tags=["coach_submissions"])



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
