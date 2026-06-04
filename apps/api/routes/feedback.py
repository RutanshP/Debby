"""Routes for coach feedback and manual grades."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from routes._errors import translate_error as _translate_error

from deps.auth import User, get_current_user
from models.feedback import SubmissionFeedback, UpsertFeedbackRequest
from services import feedback as feedback_service

router = APIRouter(tags=["feedback"])



@router.get("/recipients/{recipient_id}/feedback", response_model=SubmissionFeedback | None)
async def get_feedback_route(
    recipient_id: str,
    user: User = Depends(get_current_user),
) -> SubmissionFeedback | None:
    try:
        return await feedback_service.get_feedback(user.id, recipient_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.put("/recipients/{recipient_id}/feedback", response_model=SubmissionFeedback)
async def upsert_feedback_route(
    recipient_id: str,
    body: UpsertFeedbackRequest,
    user: User = Depends(get_current_user),
) -> SubmissionFeedback:
    try:
        return await feedback_service.upsert_feedback(user.id, recipient_id, body)
    except Exception as exc:
        raise _translate_error(exc) from exc
