from __future__ import annotations

from fastapi import APIRouter, Depends

from deps.auth import User, get_current_user
from models.case_review import CaseReview, CreateCaseReviewRequest
from services import case_reviews as case_reviews_service

router = APIRouter(prefix="/case-reviews", tags=["case-reviews"])


@router.post("", response_model=CaseReview)
async def create_case_review_route(
    body: CreateCaseReviewRequest,
    user: User = Depends(get_current_user),
) -> CaseReview:
    return await case_reviews_service.create_case_review(
        user_id=user.id,
        format=body.format,
        topic=body.topic,
        side=body.side,
        source_text=body.source_text,
        score=body.score,
        category=body.category,
        summary=body.summary,
        feedback=body.feedback,
    )
