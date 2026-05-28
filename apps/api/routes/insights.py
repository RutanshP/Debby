"""Speech insights routes — cached AI summary of a user's recent rounds."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status

try:  # pragma: no cover - import resolution only
    from deps.auth import User, get_current_user
except ImportError:  # pragma: no cover - keeps the unit bootable in isolation
    from pydantic import BaseModel

    class User(BaseModel):  # type: ignore[no-redef]
        id: str
        email: str | None = None

    async def get_current_user() -> "User":  # type: ignore[no-redef]
        raise HTTPException(status_code=401, detail="auth not configured")

from models.insights import SpeechInsights
from services import insights as insights_service

router = APIRouter(tags=["insights"])

_REFRESH_COOLDOWN_SECONDS = 60
_last_refresh: dict[str, float] = {}


@router.get("/insights")
async def get_insights_route(
    user: User = Depends(get_current_user),
) -> Any:
    cached = await insights_service.get_cached_insights(user.id)
    if cached is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return cached


@router.post("/insights/refresh", response_model=SpeechInsights)
async def refresh_insights_route(
    user: User = Depends(get_current_user),
) -> SpeechInsights:
    now = time.monotonic()
    last = _last_refresh.get(user.id)
    if last is not None and now - last < _REFRESH_COOLDOWN_SECONDS:
        retry_in = int(_REFRESH_COOLDOWN_SECONDS - (now - last))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Please wait {retry_in}s before refreshing again.",
        )
    _last_refresh[user.id] = now
    return await insights_service.refresh_insights(user.id)
