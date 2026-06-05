"""Routes for the Case Studio workspace."""

from __future__ import annotations

import csv
import random
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from deps.auth import User, get_current_user
from models.topic_limits import (
    MAX_TOPIC_WORDS,
    count_topic_words,
    validate_topic_word_limit,
)
from services.cases import analyze_case, make_case, make_mspdp_case

router = APIRouter(prefix="/cases", tags=["cases"])

Side = Literal["aff", "neg"]
Format = Literal["parli", "mspdp"]

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_PARLI_FALLBACK = [
    "Resolved: The United States should adopt universal basic income.",
    "Resolved: Social media does more harm than good.",
    "Resolved: Standardized testing should be abolished.",
]
_MSPDP_FALLBACK = [
    "Resolved: Schools should ban smartphones in classrooms.",
    "Resolved: Single-use plastics should be banned.",
    "Resolved: All countries should adopt a four-day work week.",
]


class CaseRequest(BaseModel):
    format: Format
    topic: str = Field(min_length=1)
    side: Side

    @field_validator("topic")
    @classmethod
    def topic_must_not_exceed_word_limit(cls, value: str) -> str:
        return validate_topic_word_limit(value)


class CaseResponse(BaseModel):
    case: str


class AnalyzeCaseRequest(BaseModel):
    format: Format
    side: Side
    content: str = Field(min_length=1)
    topic: str = ""

    @field_validator("topic")
    @classmethod
    def topic_must_not_exceed_word_limit(cls, value: str) -> str:
        if not value.strip():
            return ""
        return validate_topic_word_limit(value)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Case text is required.")
        return value


class RandomCaseRequest(BaseModel):
    format: Format


class RandomCaseResponse(BaseModel):
    case: str
    topic: str
    side: Side
    format: Format


def _random_topic(fmt: Format) -> str:
    csv_path = _DATA_DIR / ("parlires.csv" if fmt == "parli" else "msres.csv")
    if not csv_path.exists():
        pool = _PARLI_FALLBACK if fmt == "parli" else _MSPDP_FALLBACK
        return random.choice(pool)

    encoding = "utf-16" if fmt == "parli" else "utf-8"
    try:
        with csv_path.open(encoding=encoding, newline="") as fh:
            rows = [
                line.strip()
                for line in csv.reader(fh, delimiter="\t")
                for line in [line[-1] if line else ""]
                if line and line.strip()
            ]
    except (OSError, UnicodeDecodeError):
        rows = []

    limited_rows = [
        topic for topic in rows if count_topic_words(topic) <= MAX_TOPIC_WORDS
    ]
    pool = limited_rows or (_PARLI_FALLBACK if fmt == "parli" else _MSPDP_FALLBACK)
    return random.choice(pool)


async def _generate(fmt: Format, topic: str, side: Side) -> str:
    if fmt == "parli":
        return await make_case(topic, side)
    return await make_mspdp_case(topic, side)


@router.post("", response_model=CaseResponse)
async def create_case(
    req: CaseRequest,
    _user: User = Depends(get_current_user),
) -> CaseResponse:
    try:
        case_text = await _generate(req.format, req.topic, req.side)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Case generation failed: {exc}")
    return CaseResponse(case=case_text)


@router.post("/random", response_model=RandomCaseResponse)
async def create_random_case(
    req: RandomCaseRequest,
    _user: User = Depends(get_current_user),
) -> RandomCaseResponse:
    topic = _random_topic(req.format)
    side: Side = random.choice(["aff", "neg"])
    try:
        case_text = await _generate(req.format, topic, side)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Case generation failed: {exc}")
    return RandomCaseResponse(case=case_text, topic=topic, side=side, format=req.format)


@router.post("/analyze", response_model=CaseResponse)
async def analyze_case_route(
    req: AnalyzeCaseRequest,
    _user: User = Depends(get_current_user),
) -> CaseResponse:
    try:
        analysis = await analyze_case(
            req.format,
            req.side,
            req.content,
            topic=req.topic,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Case analysis failed: {exc}")
    return CaseResponse(case=analysis)
