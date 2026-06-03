"""Profile routes: GET/PUT /api/me/profile, POST /api/profiles/lookup."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from deps.auth import User, get_current_user
from models.profiles import Profile, ProfileLookupRequest, UpdateProfileRequest
from services import profiles as profiles_service

router = APIRouter(tags=["profiles"])


@router.get("/me/profile", response_model=Profile)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
) -> Profile:
    """Return the authenticated user's profile. display_name may be None."""
    row = await profiles_service.get_profile(current_user.id)
    if row is None:
        return Profile(user_id=current_user.id, display_name=None)
    return Profile.model_validate(row)


@router.put("/me/profile", response_model=Profile)
async def update_my_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
) -> Profile:
    """Create or update the authenticated user's display name."""
    try:
        row = await profiles_service.upsert_profile(current_user.id, body.display_name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Profile.model_validate(row)


@router.post("/profiles/lookup", response_model=dict[str, str])
async def lookup_profiles(
    body: ProfileLookupRequest,
    _current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Return a {user_id: display_name} map for the given user_ids.

    Unknown user_ids are omitted; requires the caller to be authenticated.
    """
    return await profiles_service.lookup_names(body.user_ids)
