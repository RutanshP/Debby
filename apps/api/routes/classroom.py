"""Classroom and assignment routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from routes._errors import translate_error as _translate_error

from deps.auth import User, get_current_user
from models.classroom import (
    AssignmentRecipientDetail,
    ClassDetail,
    ClassListItem,
    ClassRoom,
    CoachAssignmentSummary,
    CompleteAssignmentRequest,
    CreateAssignmentRequest,
    CreateClassRequest,
    JoinClassRequest,
    MatchDrillAssignmentRequest,
    StartAssignmentResponse,
)
from services import classroom as classroom_service

router = APIRouter(tags=["classroom"])



@router.post("/classes", response_model=ClassRoom)
async def create_class_route(
    body: CreateClassRequest,
    user: User = Depends(get_current_user),
) -> ClassRoom:
    try:
        return await classroom_service.create_class(user_id=user.id, name=body.name)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/classes/join", response_model=ClassRoom)
async def join_class_route(
    body: JoinClassRequest,
    user: User = Depends(get_current_user),
) -> ClassRoom:
    try:
        return await classroom_service.join_class(
            user_id=user.id,
            join_code=body.join_code,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/classes", response_model=list[ClassListItem])
async def list_classes_route(
    user: User = Depends(get_current_user),
) -> list[ClassListItem]:
    try:
        return await classroom_service.list_classes(user_id=user.id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/classes/{class_id}", response_model=ClassDetail)
async def get_class_route(
    class_id: str,
    user: User = Depends(get_current_user),
) -> ClassDetail:
    try:
        return await classroom_service.get_class_detail(
            user_id=user.id,
            class_id=class_id,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/classes/{class_id}/assignments", response_model=CoachAssignmentSummary)
async def create_assignment_route(
    class_id: str,
    body: CreateAssignmentRequest,
    user: User = Depends(get_current_user),
) -> CoachAssignmentSummary:
    try:
        return await classroom_service.create_assignment(
            user_id=user.id,
            class_id=class_id,
            request=body,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/assignments", response_model=list[AssignmentRecipientDetail])
async def list_assignments_route(
    user: User = Depends(get_current_user),
) -> list[AssignmentRecipientDetail]:
    try:
        return await classroom_service.list_user_assignments(user_id=user.id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/assignments/{recipient_id}", response_model=AssignmentRecipientDetail)
async def get_assignment_route(
    recipient_id: str,
    user: User = Depends(get_current_user),
) -> AssignmentRecipientDetail:
    try:
        return await classroom_service.get_assignment_detail(
            user_id=user.id,
            recipient_id=recipient_id,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/assignments/{recipient_id}/start", response_model=StartAssignmentResponse)
async def start_assignment_route(
    recipient_id: str,
    user: User = Depends(get_current_user),
) -> StartAssignmentResponse:
    try:
        return await classroom_service.start_assignment(
            user_id=user.id,
            recipient_id=recipient_id,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/assignments/{recipient_id}/complete", response_model=AssignmentRecipientDetail)
async def complete_assignment_route(
    recipient_id: str,
    body: CompleteAssignmentRequest,
    user: User = Depends(get_current_user),
) -> AssignmentRecipientDetail:
    try:
        return await classroom_service.complete_assignment(
            user_id=user.id,
            recipient_id=recipient_id,
            drill_id=body.drill_id,
            round_id=body.round_id,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/assignments/complete-matching-drill", response_model=AssignmentRecipientDetail | None)
async def complete_matching_drill_assignment_route(
    body: MatchDrillAssignmentRequest,
    user: User = Depends(get_current_user),
) -> AssignmentRecipientDetail | None:
    try:
        return await classroom_service.complete_matching_drill_assignment(
            user_id=user.id,
            drill_id=body.drill_id,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc
