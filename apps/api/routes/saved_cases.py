"""Routes for saved Case Builder outputs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from deps.auth import User, get_current_user
from models.saved_case import CreateSavedCaseRequest, SavedCase, SavedCaseSummary
from services import saved_cases as saved_cases_service

router = APIRouter(prefix="/saved-cases", tags=["saved-cases"])


@router.post("", response_model=SavedCase)
async def create_saved_case_route(
    payload: CreateSavedCaseRequest,
    user: User = Depends(get_current_user),
) -> SavedCase:
    return await saved_cases_service.create_saved_case(
        user_id=user.id,
        title=payload.title,
        topic=payload.topic,
        format=payload.format,
        side=payload.side,
        content=payload.content,
    )


@router.get("", response_model=list[SavedCaseSummary])
async def list_saved_cases_route(
    limit: int = 25,
    offset: int = 0,
    user: User = Depends(get_current_user),
) -> list[SavedCaseSummary]:
    limit = max(1, min(limit, 100))
    offset = max(offset, 0)
    return await saved_cases_service.list_saved_cases(
        user_id=user.id,
        limit=limit,
        offset=offset,
    )


@router.get("/{case_id}", response_model=SavedCase)
async def get_saved_case_route(
    case_id: str,
    user: User = Depends(get_current_user),
) -> SavedCase:
    saved = await saved_cases_service.get_saved_case(user_id=user.id, case_id=case_id)
    if saved is None:
        raise HTTPException(status_code=404, detail="Saved case not found")
    return saved


@router.delete("/{case_id}", status_code=204)
async def delete_saved_case_route(
    case_id: str,
    user: User = Depends(get_current_user),
) -> Response:
    deleted = await saved_cases_service.delete_saved_case(
        user_id=user.id,
        case_id=case_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Saved case not found")
    return Response(status_code=204)
