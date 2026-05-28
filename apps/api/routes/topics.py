"""Public topic generation route."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.topics import (
    Side,
    coin_toss,
    get_mspdp_topic,
    get_parli_topic,
    list_parli_tournaments,
)

router = APIRouter()

TopicFormat = Literal["parli", "mspdp"]


class TopicResponse(BaseModel):
    topic: str
    side: Side
    format: TopicFormat


class TournamentListResponse(BaseModel):
    tournaments: list[str]


@router.get("/topics/tournaments", response_model=TournamentListResponse)
async def get_tournaments() -> TournamentListResponse:
    return TournamentListResponse(tournaments=list_parli_tournaments())


@router.get("/topics", response_model=TopicResponse)
async def get_topic(
    format: str = Query(..., description="Debate format: 'parli' or 'mspdp'"),
    tournament: str | None = Query(None, description="Optional tournament filter for parli"),
) -> TopicResponse:
    if format == "parli":
        topic = get_parli_topic(tournament)
        fmt: TopicFormat = "parli"
    elif format == "mspdp":
        topic = get_mspdp_topic()
        fmt = "mspdp"
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid format: {format!r}. Must be 'parli' or 'mspdp'.",
        )

    return TopicResponse(topic=topic, side=coin_toss(), format=fmt)
