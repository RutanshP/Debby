from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Format = Literal["parli", "mspdp"]
Side = Literal["aff", "neg"]
SpeechType = Literal["aff", "aff_two", "neg"]


class Word(BaseModel):
    text: str
    start: int  # milliseconds
    end: int  # milliseconds


class TranscriptionResult(BaseModel):
    text: str
    audio_duration_seconds: float = 0.0
    words: list[Word] | None = None


class WpmPoint(BaseModel):
    t: float
    wpm: int


class Round(BaseModel):
    id: str
    user_id: str
    format: Format
    topic: str
    side: Side | None = None
    aff_speech: str | None = None
    neg_speech: str | None = None
    aff_two_speech: str | None = None
    rfd: str | None = None
    winner_side: Side | None = None
    flow: Any | None = None
    first_speech_wpm: int | None = None
    second_speech_wpm: int | None = None
    average_wpm: int | None = None
    wpm_series: Any | None = None
    total_speech_time: str | None = None
    created_at: str | None = None


class CreateRoundRequest(BaseModel):
    format: Format
    topic: str = Field(min_length=1)
    side: Side


class SpeechResponse(BaseModel):
    transcript: str
    wpm: int
    wpm_series: list[WpmPoint]
    duration_seconds: float
