"""Student submission detail routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from deps.auth import User, get_current_user
from models.coach_view import SubmissionDetailResponse
from routes._errors import translate_error as _translate_error
from services import coach_view as coach_view_service

router = APIRouter(tags=["student_submissions"])


@router.get(
    "/recipients/{recipient_id}/submission",
    response_model=SubmissionDetailResponse,
)
async def get_student_submission(
    recipient_id: str,
    user: User = Depends(get_current_user),
) -> SubmissionDetailResponse:
    try:
        payload = await coach_view_service.get_submission_for_student(
            student_id=user.id,
            recipient_id=recipient_id,
        )
        return SubmissionDetailResponse(**payload)
    except Exception as exc:
        raise _translate_error(exc) from exc
