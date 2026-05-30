"""Rounds REST API."""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

try:  # pragma: no cover - import resolution only
    from deps.auth import User, get_current_user  # provided by unit A1
except ImportError:  # pragma: no cover - fallback so this unit boots in isolation
    from pydantic import BaseModel

    class User(BaseModel):  # type: ignore[no-redef]
        id: str
        email: str | None = None

    async def get_current_user() -> "User":  # type: ignore[no-redef]
        # Without A1 wired in, every request is unauthorized.
        raise HTTPException(status_code=401, detail="auth not configured")

from models.round import (
    CreateRoundRequest,
    Round,
    RoundSummary,
    SpeechResponse,
    StreamingTokenResponse,
    TextSpeechRequest,
    WpmPoint,
)
from services import rounds as rounds_service
from services.fillers import (
    analyze_fillers,
    count_major_pauses,
    merge_speech_metrics,
    summarize_round_fillers,
)
from services.transcription import (
    TranscriptionError,
    create_streaming_token,
    transcribe,
)

router = APIRouter(tags=["rounds"])

_ALLOWED_SPEECH_TYPES = {"aff", "aff_two", "neg"}
_SPEECH_COLUMN = {
    "aff": "aff_speech",
    "aff_two": "aff_two_speech",
    "neg": "neg_speech",
}


@router.post("/rounds", response_model=Round)
async def create_round_route(
    payload: CreateRoundRequest,
    user: User = Depends(get_current_user),
) -> Round:
    return await rounds_service.create_round(
        user_id=user.id,
        format=payload.format,
        topic=payload.topic,
        side=payload.side,
    )


@router.get("/rounds", response_model=list[Round])
async def list_rounds_route(
    limit: int = 25,
    user: User = Depends(get_current_user),
) -> list[Round]:
    limit = max(1, min(limit, 100))
    return await rounds_service.list_rounds(user_id=user.id, limit=limit)


@router.get("/rounds/summary", response_model=list[RoundSummary])
async def list_round_summaries_route(
    limit: int = 25,
    offset: int = 0,
    user: User = Depends(get_current_user),
) -> list[RoundSummary]:
    limit = max(1, min(limit, 100))
    offset = max(offset, 0)
    return await rounds_service.list_round_summaries(
        user_id=user.id,
        limit=limit,
        offset=offset,
    )


@router.get("/rounds/{round_id}", response_model=Round)
async def get_round_route(
    round_id: str,
    user: User = Depends(get_current_user),
) -> Round:
    row = await rounds_service.get_round(user_id=user.id, round_id=round_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Round not found")
    return row


@router.post("/rounds/{round_id}/speeches", response_model=SpeechResponse)
async def add_speech_route(
    round_id: str,
    audio: UploadFile = File(...),
    speech_type: str = Form(...),
    user: User = Depends(get_current_user),
) -> SpeechResponse:
    if speech_type not in _ALLOWED_SPEECH_TYPES:
        raise HTTPException(status_code=400, detail="invalid speech_type")

    round_row = await rounds_service.get_round(user.id, round_id)
    if round_row is None:
        raise HTTPException(status_code=404, detail="Round not found")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio file is empty")

    try:
        result = await transcribe(audio_bytes, include_words=True)
    except TranscriptionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return await _save_speech_transcript(
        user=user,
        round_id=round_id,
        round_row=round_row,
        speech_type=speech_type,
        transcript=result.text,
        duration_seconds=max(result.audio_duration_seconds, 0.0),
        words=result.words or [],
    )


@router.post("/rounds/{round_id}/speeches/text", response_model=SpeechResponse)
async def add_text_speech_route(
    round_id: str,
    payload: TextSpeechRequest,
    user: User = Depends(get_current_user),
) -> SpeechResponse:
    if payload.speech_type not in _ALLOWED_SPEECH_TYPES:
        raise HTTPException(status_code=400, detail="invalid speech_type")

    round_row = await rounds_service.get_round(user.id, round_id)
    if round_row is None:
        raise HTTPException(status_code=404, detail="Round not found")

    return await _save_speech_transcript(
        user=user,
        round_id=round_id,
        round_row=round_row,
        speech_type=payload.speech_type,
        transcript=payload.transcript,
        duration_seconds=max(payload.duration_seconds, 0.0),
        words=payload.words or [],
    )


@router.get("/transcription/stream-token", response_model=StreamingTokenResponse)
async def streaming_token_route(
    user: User = Depends(get_current_user),
) -> StreamingTokenResponse:
    try:
        token = await create_streaming_token()
    except TranscriptionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return StreamingTokenResponse.model_validate(token)


async def _save_speech_transcript(
    *,
    user: User,
    round_id: str,
    round_row: Round,
    speech_type: str,
    transcript: str,
    duration_seconds: float,
    words: list,
) -> SpeechResponse:
    transcript = transcript.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="transcript is empty")

    wpm = _compute_wpm(transcript, duration_seconds)
    wpm_series = _compute_wpm_series(words, duration_seconds)
    first_wpm = wpm if speech_type == "aff" else round_row.first_speech_wpm
    second_wpm = wpm if speech_type == "aff_two" else round_row.second_speech_wpm
    average_wpm = (
        round((first_wpm + second_wpm) / 2)
        if first_wpm is not None and second_wpm is not None
        else wpm
    )
    wpm_series_store = _merge_wpm_series(
        round_row.wpm_series,
        speech_type,
        [point.model_dump() for point in wpm_series],
    )
    filler_metrics = analyze_fillers(transcript, duration_seconds)
    major_pause_count = count_major_pauses(words)
    speech_metrics_store = merge_speech_metrics(
        round_row.speech_metrics,
        speech_type,
        duration_seconds=duration_seconds,
        wpm=wpm,
        filler_count=int(filler_metrics["filler_count"]),
        filler_words=filler_metrics["filler_words"],
        filler_per_minute=float(filler_metrics["filler_per_minute"]),
        major_pause_count=major_pause_count,
    )
    round_filler_summary = summarize_round_fillers(speech_metrics_store)
    total_speech_seconds = _add_interval_seconds(
        round_row.total_speech_time,
        duration_seconds,
    )

    update_fields: dict[str, Any] = {
        _SPEECH_COLUMN[speech_type]: transcript,
        "average_wpm": average_wpm,
        "wpm_series": wpm_series_store,
        "speech_metrics": speech_metrics_store,
        "filler_count": round_filler_summary["filler_count"],
        "filler_per_minute": round_filler_summary["filler_per_minute"],
        "major_pause_count": round_filler_summary["major_pause_count"],
        "total_speech_time": _format_interval_seconds(total_speech_seconds),
    }
    if speech_type == "aff":
        update_fields["first_speech_wpm"] = wpm
    elif speech_type == "aff_two":
        update_fields["second_speech_wpm"] = wpm

    await rounds_service.update_round(user.id, round_id, update_fields)

    return SpeechResponse(
        transcript=transcript,
        wpm=wpm,
        wpm_series=wpm_series,
        duration_seconds=duration_seconds,
        filler_count=int(filler_metrics["filler_count"]),
        filler_words=filler_metrics["filler_words"],
        filler_per_minute=float(filler_metrics["filler_per_minute"]),
        major_pause_count=major_pause_count,
    )


def _merge_wpm_series(existing: Any, speech_type: str, series: list[dict[str, Any]]) -> Any:
    if speech_type not in {"aff", "aff_two"}:
        return existing if existing is not None else {}

    if isinstance(existing, dict):
        merged = dict(existing)
    else:
        merged = {}
        if isinstance(existing, list):
            merged["aff"] = existing

    merged[speech_type] = series
    return merged


def _parse_interval_seconds(value: Any) -> float:
    """Parse common Supabase/Postgres interval representations into seconds."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return max(float(value), 0.0)
    if isinstance(value, dict):
        seconds = 0.0
        seconds += float(value.get("hours") or 0) * 3600
        seconds += float(value.get("minutes") or 0) * 60
        seconds += float(value.get("seconds") or 0)
        return max(seconds, 0.0)
    if not isinstance(value, str):
        return 0.0

    text = value.strip()
    if not text:
        return 0.0

    parts = text.split(":")
    try:
        if len(parts) == 3:
            return max(
                (float(parts[0]) * 3600) + (float(parts[1]) * 60) + float(parts[2]),
                0.0,
            )
        if len(parts) == 2:
            return max((float(parts[0]) * 60) + float(parts[1]), 0.0)
        if len(parts) == 1:
            return max(float(parts[0]), 0.0)
    except ValueError:
        return 0.0
    return 0.0


def _add_interval_seconds(existing: Any, addition: float) -> float:
    return _parse_interval_seconds(existing) + max(float(addition or 0), 0.0)


def _format_interval_seconds(seconds: float) -> str:
    whole_seconds = max(round(seconds), 0)
    hours, remainder = divmod(whole_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _compute_wpm(transcript: str, duration_seconds: float) -> int:
    word_count = len((transcript or "").split())
    minutes = max(duration_seconds / 60.0, 1 / 60.0)
    return round(word_count / minutes)


def _compute_wpm_series(words: list, duration_seconds: float, interval: int = 2) -> list[WpmPoint]:
    duration = max(duration_seconds, 1.0)
    bucket_count = max(math.ceil(duration / interval), 1)
    buckets = [0] * bucket_count

    for word in words:
        start_ms = getattr(word, "start", None)
        if start_ms is None:
            continue
        bucket_index = min(int((start_ms / 1000.0) // interval), bucket_count - 1)
        buckets[bucket_index] += 1

    series: list[WpmPoint] = []
    for index, count in enumerate(buckets):
        start_second = index * interval
        end_second = min(start_second + interval, duration)
        bucket_seconds = max(end_second - start_second, 1)
        series.append(
            WpmPoint(t=float(start_second), wpm=round((count / bucket_seconds) * 60))
        )
    return series
