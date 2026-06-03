"""Routes for coach feedback and manual grades."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from deps.auth import User, get_current_user
from models.feedback import SubmissionFeedback, UpsertFeedbackRequest
from services import feedback as feedback_service

router = APIRouter(tags=["feedback"])


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


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
