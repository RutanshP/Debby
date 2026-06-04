"""Class-admin routes: rename, archive, regenerate code, remove/leave, edit/delete assignment."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from deps.auth import User, get_current_user
from models.class_admin import (
    UpdateAssignmentRequest,
    UpdateClassRequest,
    UpdateMemberRoleRequest,
)
from models.classroom import Assignment, ClassMember, ClassRoom
from services import class_admin as class_admin_service

router = APIRouter(tags=["class_admin"])


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.patch("/classes/{class_id}", response_model=ClassRoom)
async def update_class_route(
    class_id: str,
    body: UpdateClassRequest,
    user: User = Depends(get_current_user),
) -> ClassRoom:
    try:
        return await class_admin_service.update_class(user.id, class_id, body)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/classes/{class_id}/regenerate-code", response_model=ClassRoom)
async def regenerate_code_route(
    class_id: str,
    user: User = Depends(get_current_user),
) -> ClassRoom:
    try:
        return await class_admin_service.regenerate_code(user.id, class_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.delete("/classes/{class_id}/members/{user_id}", status_code=204)
async def remove_member_route(
    class_id: str,
    user_id: str,
    user: User = Depends(get_current_user),
) -> None:
    try:
        await class_admin_service.remove_member(user.id, class_id, user_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.patch("/classes/{class_id}/members/{user_id}", response_model=ClassMember)
async def update_member_role_route(
    class_id: str,
    user_id: str,
    body: UpdateMemberRoleRequest,
    user: User = Depends(get_current_user),
) -> ClassMember:
    try:
        row = await class_admin_service.update_member_role(
            user.id,
            class_id,
            user_id,
            body.role,
        )
        return ClassMember.model_validate(row)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/classes/{class_id}/leave", status_code=204)
async def leave_class_route(
    class_id: str,
    user: User = Depends(get_current_user),
) -> None:
    try:
        await class_admin_service.leave_class(user.id, class_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.patch("/assignments/{assignment_id}", response_model=Assignment)
async def update_assignment_route(
    assignment_id: str,
    body: UpdateAssignmentRequest,
    user: User = Depends(get_current_user),
) -> Assignment:
    try:
        return await class_admin_service.update_assignment(user.id, assignment_id, body)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.delete("/assignments/{assignment_id}", status_code=204)
async def delete_assignment_route(
    assignment_id: str,
    user: User = Depends(get_current_user),
) -> None:
    try:
        await class_admin_service.delete_assignment(user.id, assignment_id)
    except Exception as exc:
        raise _translate_error(exc) from exc
