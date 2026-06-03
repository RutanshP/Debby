"""Generate and cache AI speech insights from a user's recent rounds."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from models.insights import SpeechInsights, SpeechInsightsSummary
from services.ai import MODEL, _truncate_for_flow
from services.openai_client import client
from services.rounds import list_rounds
from services.supabase_client import get_supabase

_TABLE = "speech_insights"
_ROUND_LIMIT = 10
_PER_SPEECH_CHAR_LIMIT = 1200

_SYSTEM = (
    "You are a debate coach reviewing a student's last 10 practice speeches. "
    "Identify patterns across rounds, not single-round critique. "
    "Return JSON with keys: headline (one sentence), strengths (3 short bullets), "
    "recurring_issues (3 short bullets covering things like signposting, pacing, "
    "evidence, warranting, impact weighing, filler words, long pauses), suggested_focus (one actionable next step). "
    "Each bullet must be under 18 words. Be concrete, kind, and specific to what "
    "actually appears in the transcripts."
)


def _build_corpus(rounds: list[Any]) -> tuple[str, int]:
    """Concatenate only the student's own speeches from each round.

    For AFF rounds, the student owns `aff_speech` and `aff_two_speech`.
    For NEG rounds, the student owns `neg_speech`.
    Debby's speeches must never be included or the generated insights will
    evaluate the AI instead of the user.
    """
    blocks: list[str] = []
    used = 0
    for r in rounds:
        side = getattr(r, "side", None)
        speeches: list[str] = []
        if side == "aff":
            aff = _truncate_for_flow(
                getattr(r, "aff_speech", None),
                _PER_SPEECH_CHAR_LIMIT,
            )
            rebuttal = _truncate_for_flow(
                getattr(r, "aff_two_speech", None),
                _PER_SPEECH_CHAR_LIMIT,
            )
            if aff:
                speeches.append(f"CONSTRUCTIVE:\n{aff}")
            if rebuttal:
                speeches.append(f"REBUTTAL:\n{rebuttal}")
        elif side == "neg":
            neg = _truncate_for_flow(
                getattr(r, "neg_speech", None),
                _PER_SPEECH_CHAR_LIMIT,
            )
            if neg:
                speeches.append(f"NEGATIVE SPEECH:\n{neg}")
        if not speeches:
            continue
        metrics = getattr(r, "speech_metrics", None)
        metric_line = ""
        if isinstance(metrics, dict):
            filler_bits = []
            relevant_speech_types = (
                {"aff", "aff_two"} if side == "aff" else {"neg"} if side == "neg" else set()
            )
            for speech_type, value in metrics.items():
                if not isinstance(value, dict):
                    continue
                if speech_type not in relevant_speech_types:
                    continue
                filler_count = int(value.get("filler_count") or 0)
                pause_count = int(value.get("major_pause_count") or 0)
                filler_rate = float(value.get("filler_per_minute") or 0)
                if filler_count > 0 or pause_count > 0:
                    filler_bits.append(
                        f"{speech_type}: {filler_count} fillers, {filler_rate}/min, {pause_count} major pauses"
                    )
            if filler_bits:
                metric_line = "\nFILLER METRICS: " + "; ".join(filler_bits)
        used += 1
        topic = getattr(r, "topic", "") or ""
        blocks.append(
            f"--- Round {used} ({topic}) ---\n"
            + "\n\n".join(speeches)
            + metric_line
        )
    return "\n\n".join(blocks), used


async def _generate_summary(rounds: list[Any]) -> tuple[SpeechInsightsSummary, int]:
    corpus, used = _build_corpus(rounds)
    if used == 0:
        return (
            SpeechInsightsSummary(
                headline="Run a few practice rounds to unlock personalized insights.",
                strengths=[],
                recurring_issues=[],
                suggested_focus="Complete one full round so Debby can review your speeches.",
            ),
            0,
        )

    response = await client.chat.completions.create(
        model=MODEL,
        max_tokens=600,
        temperature=0.3,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Review the following {used} recent practice rounds and "
                    f"return the JSON described.\n\n{corpus}"
                ),
            },
        ],
    )
    raw = response.choices[0].message.content or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"insights: malformed JSON from model: {raw!r}") from exc

    return SpeechInsightsSummary.model_validate(data), used


async def _get_cached(user_id: str) -> SpeechInsights | None:
    sb = get_supabase()

    def _do() -> dict[str, Any] | None:
        resp = (
            sb.table(_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    row = await asyncio.to_thread(_do)
    if not row:
        return None
    return SpeechInsights.model_validate(
        {
            "summary": row["summary"],
            "rounds_covered": row["rounds_covered"],
            "generated_at": row["generated_at"],
        }
    )


async def _upsert(user_id: str, summary: SpeechInsightsSummary, used: int) -> SpeechInsights:
    sb = get_supabase()
    payload = {
        "user_id": user_id,
        "summary": summary.model_dump(),
        "rounds_covered": used,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    def _do() -> dict[str, Any]:
        resp = sb.table(_TABLE).upsert(payload, on_conflict="user_id").execute()
        data = getattr(resp, "data", None) or []
        if not data:
            raise RuntimeError("Supabase upsert returned no rows")
        return data[0]

    row = await asyncio.to_thread(_do)
    return SpeechInsights.model_validate(
        {
            "summary": row["summary"],
            "rounds_covered": row["rounds_covered"],
            "generated_at": row["generated_at"],
        }
    )


async def get_cached_insights(user_id: str) -> SpeechInsights | None:
    return await _get_cached(user_id)


async def refresh_insights(user_id: str) -> SpeechInsights:
    rounds = await list_rounds(user_id=user_id, limit=_ROUND_LIMIT)
    summary, used = await _generate_summary(rounds)
    return await _upsert(user_id, summary, used)
