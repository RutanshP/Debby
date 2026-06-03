"""Topic-level evidence fetch + cache for grounded Debby speeches."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from models.evidence import TopicEvidence
from services.openai_client import client
from services.supabase_client import get_supabase

_TABLE = "topic_evidence_cache"
_SEARCH_MODEL = "gpt-4o-mini"
_CACHE_TTL_DAYS = 30
_QUANTITATIVE_SIGNAL_RE = re.compile(r"\d")

_SYSTEM = (
    "You are a debate research assistant. Use web search to gather a small set "
    "of reliable evidence cards for one side of a debate topic. Return JSON "
    "only with this shape: "
    '{"cards":[{"tag":"short claim","evidence":"2-4 sentence factual summary","source_title":"title","source_url":"https://...","source_type":"government|ngo|academic|news|industry|other"}]}. '
    "Use at most 3 cards. Prefer recent and reputable sources. Every card's "
    "evidence field must include at least one concrete quantitative datapoint "
    "such as a number, percentage, ranking, dollar figure, year, count, or "
    "measured comparison from the source. Do not return purely qualitative or "
    "analytical summaries without a numeric datapoint. Do not invent studies, "
    'statistics, institutions, or URLs. If the evidence is genuinely unclear, return {"cards":[]}.'
)


def _normalize_topic(topic: str) -> str:
    cleaned = " ".join((topic or "").strip().lower().split())
    return cleaned


def _cache_key(topic: str, side: str) -> str:
    return f"{side}:{_normalize_topic(topic)}"


def _is_fresh(iso_timestamp: str | None) -> bool:
    if not iso_timestamp:
        return False
    try:
        parsed = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed >= datetime.now(timezone.utc) - timedelta(days=_CACHE_TTL_DAYS)


def _row_to_topic_evidence(row: dict[str, Any]) -> TopicEvidence:
    return TopicEvidence.model_validate(
        {
            "topic": row.get("topic", ""),
            "side": row.get("side", "aff"),
            "cards": row.get("cards") or [],
            "generated_at": row.get("generated_at"),
            "updated_at": row.get("updated_at"),
        }
    )


def _looks_quantitative(text: str) -> bool:
    return bool(_QUANTITATIVE_SIGNAL_RE.search(text or ""))


async def _get_cached(topic: str, side: str) -> TopicEvidence | None:
    cache_key = _cache_key(topic, side)
    supabase = get_supabase()

    def _do() -> dict[str, Any] | None:
        response = (
            supabase.table(_TABLE)
            .select("*")
            .eq("cache_key", cache_key)
            .limit(1)
            .execute()
        )
        rows = getattr(response, "data", None) or []
        return rows[0] if rows else None

    row = await asyncio.to_thread(_do)
    if not row:
        return None
    evidence = _row_to_topic_evidence(row)
    if not evidence.cards:
        return None
    if not _is_fresh(evidence.updated_at or evidence.generated_at):
        return None
    return evidence


async def _upsert(topic: str, side: str, cards: list[dict[str, Any]]) -> TopicEvidence:
    supabase = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "cache_key": _cache_key(topic, side),
        "topic": topic.strip(),
        "normalized_topic": _normalize_topic(topic),
        "side": side,
        "cards": cards,
        "provider": "openai_web_search",
        "model": _SEARCH_MODEL,
        "generated_at": now,
        "updated_at": now,
    }

    def _do() -> dict[str, Any]:
        response = supabase.table(_TABLE).upsert(payload, on_conflict="cache_key").execute()
        rows = getattr(response, "data", None) or []
        if not rows:
            raise RuntimeError("Supabase upsert returned no rows")
        return rows[0]

    row = await asyncio.to_thread(_do)
    return _row_to_topic_evidence(row)


async def _fetch_from_openai(topic: str, side: str) -> list[dict[str, Any]]:
    side_label = "affirmative" if side == "aff" else "negative"
    response = await client.responses.create(
        model=_SEARCH_MODEL,
        tools=[{"type": "web_search"}],
        input=(
            f"Find grounded evidence for the {side_label} side of this debate topic: {topic}\n\n"
            "Return only the JSON object described in the system message. "
            "Prefer government, academic, NGO, major-news, or primary institutional sources."
        ),
        instructions=_SYSTEM,
    )
    raw = (getattr(response, "output_text", "") or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    cards = data.get("cards")
    if not isinstance(cards, list):
        return []
    normalized: list[dict[str, Any]] = []
    for card in cards[:3]:
        if not isinstance(card, dict):
            continue
        tag = str(card.get("tag") or "").strip()
        evidence = str(card.get("evidence") or "").strip()
        source_title = str(card.get("source_title") or "").strip()
        source_url = str(card.get("source_url") or "").strip()
        source_type = str(card.get("source_type") or "").strip() or None
        if not tag or not evidence or not source_title or not source_url:
            continue
        if not _looks_quantitative(evidence):
            continue
        normalized.append(
            {
                "tag": tag,
                "evidence": evidence,
                "source_title": source_title,
                "source_url": source_url,
                "source_type": source_type,
            }
        )
    return normalized


async def get_topic_evidence(topic: str, side: str) -> TopicEvidence | None:
    cached = await _get_cached(topic, side)
    if cached is not None:
        return cached
    try:
        cards = await _fetch_from_openai(topic, side)
    except Exception:
        return None
    if not cards:
        return None
    try:
        return await _upsert(topic, side, cards)
    except Exception:
        return TopicEvidence(topic=topic, side=side, cards=cards)


async def get_prompt_block(topic: str, side: str) -> str:
    evidence = await get_topic_evidence(topic, side)
    if evidence is None or not evidence.cards:
        return (
            "No external evidence cards were supplied. Do not invent studies, "
            "statistics, experts, institutions, or historical examples. Rely on "
            "logical warranting and general analysis instead."
        )

    lines = [
        "Use only the evidence cards below for outside factual support. Do not invent any additional studies, statistics, expert claims, source names, or URLs.",
        "Use a card only if it genuinely supports the contention you are making. Do not force unrelated evidence into background or an unrelated contention.",
        "Prefer spreading different relevant cards across different major contentions when possible.",
        "If no card fits a contention, rely on logical warranting instead of stretching an unrelated card.",
    ]
    for index, card in enumerate(evidence.cards, start=1):
        source_type = f" ({card.source_type})" if card.source_type else ""
        lines.append(
            f"Card {index} - {card.tag}: {card.evidence} Source: {card.source_title}{source_type} - {card.source_url}"
        )
    return "\n".join(lines)
