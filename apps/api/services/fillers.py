"""Filler-word detection helpers shared by practice rounds and drills."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

FILLER_WORDS = {
    "um",
    "uh",
    "erm",
    "er",
    "ah",
    "hmm",
    "basically",
}

FILLER_PHRASES = {
    "you know",
    "i mean",
    "sort of",
    "kind of",
    "so like",
    "and like",
    "but like",
    "like i",
    "like we",
    "like you",
    "like they",
}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z']+", (text or "").lower())


def analyze_fillers(text: str, duration_seconds: float = 0.0) -> dict[str, Any]:
    tokens = _tokens(text)
    counts: Counter[str] = Counter(token for token in tokens if token in FILLER_WORDS)
    compact = " ".join(tokens)
    for phrase in FILLER_PHRASES:
        matches = re.findall(rf"(?<!\w){re.escape(phrase)}(?!\w)", compact)
        if matches:
            counts[phrase] += len(matches)

    total = sum(counts.values())
    minutes = max(float(duration_seconds or 0) / 60.0, 0.0)
    return {
        "filler_count": total,
        "filler_words": dict(sorted(counts.items())),
        "filler_per_minute": round(total / minutes, 2) if minutes > 0 else 0.0,
    }


def merge_speech_metrics(
    existing: Any,
    speech_type: str,
    *,
    duration_seconds: float,
    wpm: int,
    filler_count: int,
    filler_words: dict[str, int],
    filler_per_minute: float,
) -> dict[str, Any]:
    merged = dict(existing) if isinstance(existing, dict) else {}
    merged[speech_type] = {
        "duration_seconds": duration_seconds,
        "wpm": wpm,
        "filler_count": filler_count,
        "filler_words": filler_words,
        "filler_per_minute": filler_per_minute,
    }
    return merged


def summarize_round_fillers(metrics: Any) -> dict[str, Any]:
    if not isinstance(metrics, dict):
        return {"filler_count": 0, "filler_per_minute": 0.0}

    total_fillers = 0
    total_duration = 0.0
    for value in metrics.values():
        if not isinstance(value, dict):
            continue
        total_fillers += int(value.get("filler_count") or 0)
        try:
            total_duration += max(float(value.get("duration_seconds") or 0), 0.0)
        except (TypeError, ValueError):
            continue

    minutes = total_duration / 60.0
    return {
        "filler_count": total_fillers,
        "filler_per_minute": round(total_fillers / minutes, 2) if minutes > 0 else 0.0,
    }
