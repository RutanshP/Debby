"""HTTP routes for drill generation, scoring, and audio scoring."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from models.drill import (
    Drill,
    DrillCreateRequest,
    DrillPrompt,
    DrillScore,
    DrillScoreRequest,
    DrillType,
    SpeedScore,
)
from services.drills import (
    calculate_reading_accuracy,
    compute_wpm,
    generate_drill,
    reading_match_counts,
    score_drill,
    transcribe_audio,
)
from models.round import WpmPoint

# ---------------------------------------------------------------------------
# Auth dep (provided by A1; we import lazily so a minimal stub can supply it
# during integration). We resolve at call-time to keep this unit independent.
# ---------------------------------------------------------------------------


def _get_current_user_dep():
    try:
        from deps.auth import get_current_user  # type: ignore
    except Exception:  # pragma: no cover - fallback for early integration
        from fastapi import Header

        async def get_current_user(authorization: str | None = Header(default=None)):
            if not authorization or not authorization.lower().startswith("bearer "):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Missing or invalid bearer token.",
                )

            class _User:
                id = "test-user"
                email = None

            return _User()

    return get_current_user


get_current_user = _get_current_user_dep()


# ---------------------------------------------------------------------------
# Supabase service-role client (A4). We use a lazy helper so tests can patch.
# ---------------------------------------------------------------------------


def _supabase_client():
    try:
        from services.supabase import service_role_client  # type: ignore

        return service_role_client()
    except Exception:
        return None


# In-memory fallback store so the unit is testable without Supabase.
_FALLBACK_STORE: dict[str, dict[str, Any]] = {}


def _persist_drill(row: dict[str, Any]) -> dict[str, Any]:
    sb = _supabase_client()
    if sb is None:
        _FALLBACK_STORE[row["id"]] = row
        return row
    try:
        result = sb.table("drills").insert(row).execute()
        data = getattr(result, "data", None)
        if isinstance(data, list) and data:
            return data[0]
    except Exception:
        pass
    _FALLBACK_STORE[row["id"]] = row
    return row


def _fetch_drill(drill_id: str, user_id: str) -> dict[str, Any] | None:
    sb = _supabase_client()
    if sb is None:
        row = _FALLBACK_STORE.get(drill_id)
        if row and row["user_id"] == user_id:
            return row
        return None
    try:
        result = (
            sb.table("drills")
            .select("*")
            .eq("id", drill_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return getattr(result, "data", None)
    except Exception:
        row = _FALLBACK_STORE.get(drill_id)
        if row and row["user_id"] == user_id:
            return row
        return None


def _update_drill(drill_id: str, user_id: str, patch: dict[str, Any]) -> None:
    sb = _supabase_client()
    if sb is None:
        if drill_id in _FALLBACK_STORE:
            _FALLBACK_STORE[drill_id].update(patch)
        return
    try:
        sb.table("drills").update(patch).eq("id", drill_id).eq("user_id", user_id).execute()
    except Exception:
        if drill_id in _FALLBACK_STORE:
            _FALLBACK_STORE[drill_id].update(patch)


def _row_to_drill(row: dict[str, Any]) -> Drill:
    prompt_data = row["prompt"]
    if isinstance(prompt_data, str):
        import json

        prompt_data = json.loads(prompt_data)
    score_data = row.get("score")
    if isinstance(score_data, str):
        import json

        score_data = json.loads(score_data)
    parsed_score: DrillScore | SpeedScore | None = None
    if isinstance(score_data, dict) and "wpm" in score_data:
        try:
            parsed_score = SpeedScore(**score_data)
        except Exception:
            parsed_score = None
    elif isinstance(score_data, dict) and "score" in score_data:
        try:
            parsed_score = DrillScore(**score_data)
        except Exception:
            parsed_score = None
    return Drill(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        drill_type=row["drill_type"],
        prompt=DrillPrompt(**prompt_data),
        response=row.get("response"),
        score=parsed_score,
        timer_seconds=row.get("timer_seconds"),
        created_at=row.get("created_at"),
    )


router = APIRouter()


def _list_drills(user_id: str, limit: int) -> list[dict[str, Any]]:
    sb = _supabase_client()
    if sb is None:
        rows = [r for r in _FALLBACK_STORE.values() if r["user_id"] == user_id]
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return rows[:limit]
    try:
        result = (
            sb.table("drills")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return list(getattr(result, "data", None) or [])
    except Exception:
        rows = [r for r in _FALLBACK_STORE.values() if r["user_id"] == user_id]
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return rows[:limit]


@router.get("/drills", response_model=list[Drill])
async def list_drills_route(
    limit: int = 25,
    user=Depends(get_current_user),
) -> list[Drill]:
    limit = max(1, min(limit, 200))
    rows = _list_drills(user.id, limit)
    return [_row_to_drill(r) for r in rows if r.get("prompt") is not None]


@router.post("/drills", response_model=Drill)
async def create_drill(
    body: DrillCreateRequest,
    user=Depends(get_current_user),
) -> Drill:
    try:
        prompt = await generate_drill(body.drill_type, timer_seconds=body.timer_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row = {
        "id": str(uuid.uuid4()),
        "user_id": user.id,
        "drill_type": body.drill_type,
        "prompt": prompt.model_dump(),
        "response": None,
        "score": None,
        "timer_seconds": prompt.timer_seconds,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    stored = _persist_drill(row)
    return _row_to_drill(stored)


@router.post("/drills/{drill_id}/score", response_model=DrillScore)
async def score_drill_route(
    drill_id: str,
    body: DrillScoreRequest,
    user=Depends(get_current_user),
) -> DrillScore:
    row = _fetch_drill(drill_id, user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Drill not found.")

    drill = _row_to_drill(row)
    score = await score_drill(drill.drill_type, drill.prompt, body.response)
    _update_drill(drill_id, user.id, {"response": body.response, "score": score.model_dump()})
    return score


@router.post("/drills/{drill_id}/score-speed", response_model=SpeedScore)
async def score_speed_route(
    drill_id: str,
    audio: UploadFile = File(...),
    user=Depends(get_current_user),
) -> SpeedScore:
    row = _fetch_drill(drill_id, user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Drill not found.")

    api_key = (os.getenv("ASSEMBLYAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="AssemblyAI not configured.")

    drill = _row_to_drill(row)
    audio_bytes = await audio.read()

    try:
        transcript, duration, words = await transcribe_audio(
            audio_bytes, api_key, include_words=True
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

    matched_words, _attempted_words, passage_words = reading_match_counts(
        drill.prompt.prompt, transcript
    )
    accuracy = calculate_reading_accuracy(drill.prompt.prompt, transcript)
    completion = min(matched_words / passage_words, 1.0) if passage_words else 0.0
    wpm = compute_wpm(transcript, duration)
    wpm_series = _compute_speed_wpm_series(words, transcript, duration)
    derived_score = _speed_score_to_ten(wpm=wpm, accuracy=accuracy, completion=completion)

    _update_drill(
        drill_id,
        user.id,
        {
            "response": transcript,
            "score": {
                "accuracy": accuracy,
                "completion": completion,
                "duration_seconds": duration,
                "wpm": wpm,
                "wpm_series": [point.model_dump() for point in wpm_series],
                "score": derived_score,
            },
        },
    )
    return SpeedScore(
        accuracy=accuracy,
        completion=completion,
        duration_seconds=duration,
        wpm=wpm,
        wpm_series=wpm_series,
        score=derived_score,
    )


@router.post("/drills/{drill_id}/score-audio", response_model=DrillScore)
async def score_audio_route(
    drill_id: str,
    audio: UploadFile = File(...),
    user=Depends(get_current_user),
) -> DrillScore:
    row = _fetch_drill(drill_id, user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Drill not found.")

    drill = _row_to_drill(row)
    if drill.drill_type not in {"rebuttal", "impact"}:
        raise HTTPException(
            status_code=400, detail="This drill type does not use audio scoring here."
        )

    api_key = (os.getenv("ASSEMBLYAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="AssemblyAI not configured.")

    audio_bytes = await audio.read()
    try:
        transcript, _duration = await transcribe_audio(audio_bytes, api_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

    if not transcript:
        raise HTTPException(status_code=400, detail="No speech was detected in the recording.")

    score = await score_drill(drill.drill_type, drill.prompt, transcript)
    _update_drill(drill_id, user.id, {"response": transcript, "score": score.model_dump()})
    return score


def _compute_speed_wpm_series(
    words: list[dict[str, Any]],
    transcript: str,
    duration_seconds: float,
    interval: int = 2,
) -> list[WpmPoint]:
    duration = max(float(duration_seconds or 0), 1.0)
    bucket_count = max(int((duration + interval - 0.001) // interval), 1)
    buckets = [0] * bucket_count

    if words:
        for word in words:
            start_ms = word.get("start")
            try:
                start_seconds = float(start_ms) / 1000.0
            except (TypeError, ValueError):
                continue
            bucket_index = min(int(start_seconds // interval), bucket_count - 1)
            buckets[bucket_index] += 1
    else:
        # Fallback for transcripts without timestamps: spread words evenly so the
        # chart still communicates overall speed instead of disappearing.
        total_words = len((transcript or "").split())
        for index in range(total_words):
            bucket_index = min(int((index / max(total_words, 1)) * bucket_count), bucket_count - 1)
            buckets[bucket_index] += 1

    series: list[WpmPoint] = []
    for index, count in enumerate(buckets):
        start_second = index * interval
        end_second = min(start_second + interval, duration)
        bucket_seconds = max(end_second - start_second, 1.0)
        series.append(
            WpmPoint(t=float(start_second), wpm=round((count / bucket_seconds) * 60))
        )
    return series


def _component_from_thresholds(
    value: float,
    thresholds: list[tuple[float, float]],
) -> float:
    """Linearly interpolate a 0-10 component from ascending thresholds."""

    if value <= thresholds[0][0]:
        return thresholds[0][1]
    for (low_value, low_score), (high_value, high_score) in zip(
        thresholds, thresholds[1:]
    ):
        if value <= high_value:
            span = high_value - low_value
            if span <= 0:
                return high_score
            ratio = (value - low_value) / span
            return low_score + (ratio * (high_score - low_score))
    return thresholds[-1][1]


def _speed_score_to_ten(wpm: int, accuracy: float, completion: float) -> int:
    """Convert speed-reading metrics into an accuracy-weighted 0-10 score.

    Completion is intentionally ignored: speed drills score how fast and
    accurately the attempted reading was, not whether the user reached the end.
    """

    del completion

    accuracy_pct = max(min(float(accuracy), 1.0), 0.0) * 100.0
    if accuracy_pct < 60.0:
        return 0

    speed_component = _component_from_thresholds(
        max(float(wpm), 0.0),
        [
            (0.0, 1.0),
            (100.0, 1.0),
            (140.0, 3.0),
            (180.0, 5.0),
            (220.0, 7.0),
            (260.0, 8.5),
            (300.0, 10.0),
        ],
    )
    accuracy_component = _component_from_thresholds(
        accuracy_pct,
        [
            (60.0, 1.0),
            (70.0, 3.0),
            (80.0, 5.5),
            (85.0, 7.0),
            (90.0, 8.5),
            (95.0, 10.0),
            (100.0, 10.0),
        ],
    )

    score = round((accuracy_component * 0.55) + (speed_component * 0.45))

    if accuracy_pct < 75.0:
        score = min(score, 5)
    elif accuracy_pct < 85.0:
        score = min(score, 7)
    elif accuracy_pct < 90.0:
        score = min(score, 8)
    elif accuracy_pct < 95.0:
        score = min(score, 9)

    if wpm >= 300 and accuracy_pct >= 95.0:
        return 10
    return max(0, min(score, 10))
