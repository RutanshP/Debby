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
    "evidence, warranting, impact weighing), suggested_focus (one actionable next step). "
    "Each bullet must be under 18 words. Be concrete, kind, and specific to what "
    "actually appears in the transcripts."
)


def _build_corpus(rounds: list[Any]) -> tuple[str, int]:
    """Concatenate the user's AFF constructive + rebuttal from each round.

    We never include Debby's `neg_speech` so the model evaluates only the
    student's own speaking.
    """
    blocks: list[str] = []
    used = 0
    for r in rounds:
        speeches: list[str] = []
        aff = _truncate_for_flow(getattr(r, "aff_speech", None), _PER_SPEECH_CHAR_LIMIT)
        rebuttal = _truncate_for_flow(
            getattr(r, "aff_two_speech", None), _PER_SPEECH_CHAR_LIMIT
        )
        if aff:
            speeches.append(f"CONSTRUCTIVE:\n{aff}")
        if rebuttal:
            speeches.append(f"REBUTTAL:\n{rebuttal}")
        if not speeches:
            continue
        used += 1
        topic = getattr(r, "topic", "") or ""
        blocks.append(
            f"--- Round {used} ({topic}) ---\n" + "\n\n".join(speeches)
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
