"""Drill generation and scoring service.

Ported from backend/debby.py (lines 228-440) to async + Pydantic structured
outputs. Speed drills are timer-aware: the word target is derived from
``timer_seconds`` and the resulting passage is trimmed to fit.
"""

from __future__ import annotations

import io
import json
import random
import re
from difflib import SequenceMatcher
from typing import Any

import httpx

try:
    # The shared async OpenAI client lives in A3's openai_client module. If
    # that unit is not yet merged we fall back to a locally-constructed one.
    from services.openai_client import client as _openai_client  # type: ignore
except Exception:  # pragma: no cover - import-time fallback
    from openai import AsyncOpenAI

    _openai_client = AsyncOpenAI()

from models.drill import (
    DRILL_TITLES,
    DrillPrompt,
    DrillScore,
    DrillType,
    SpeedScore,
    _LEGACY_TYPE,
)
from services import speed_passages

OPENAI_MODEL = "gpt-4o-mini-2024-07-18"
ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"
SPEED_PASSAGE_CATEGORY_LIMIT = 20


# ---------------------------------------------------------------------------
# Speed-passage helpers (mirror backend/debby.py:85-128)
# ---------------------------------------------------------------------------


def speed_passage_word_target(timer_seconds: int | None) -> int:
    try:
        seconds = int(timer_seconds) if timer_seconds is not None else 60
    except (TypeError, ValueError):
        seconds = 60
    return min(max(round(seconds * 5), 30), 600)


def _word_count(text: str | None) -> int:
    return len(re.findall(r"\b[\w']+\b", text or ""))


def _fit_speed_passage_to_target(text: str | None, target_words: int) -> str:
    words = re.findall(r"\S+", (text or "").strip())
    if len(words) <= target_words:
        return (text or "").strip()
    trimmed = " ".join(words[:target_words]).strip()
    if trimmed and trimmed[-1] not in ".!?":
        trimmed += "."
    return trimmed


def _looks_like_speed_passage(text: str | None) -> bool:
    text = (text or "").strip()
    if not text:
        return False
    lower = text.lower()
    if lower.startswith(
        ("discuss ", "explain ", "write ", "describe ", "argue ", "respond ", "list ")
    ):
        return False
    return len(re.findall(r"\b[\w']+\b", text)) >= 30


_FALLBACK_SENTENCES = [
    "On a spring afternoon, a small basketball team changed its season by changing the way it practiced.",
    "Instead of running the same drills every day, the players studied spacing, watched film, and learned how to pass before the defense could settle.",
    "Their best scorer still took difficult shots, but the offense no longer depended on one person solving every problem.",
    "A quiet forward began setting sharper screens, a freshman guard learned when to slow the tempo, and the bench started treating every rebound like a chance to reset the game.",
    "By the playoffs, the team looked faster because it was thinking earlier.",
    "The same pattern shows up in restaurants, science labs, city buses, and school clubs: small systems often matter more than one dramatic talent.",
    "When people notice the pattern, they can improve without waiting for perfect conditions.",
    "They adjust the routine, measure what changes, and keep the parts that make the whole group steadier.",
    "Progress rarely feels cinematic while it is happening.",
    "It usually sounds like clear instructions, better timing, and a few people deciding to pay attention at the same moment.",
]


_SPEED_TOPIC_AREAS = [
    {
        "category": "debate",
        "label": "debate, public speaking, or argument strategy",
        "subtopics": [
            "cross-examination",
            "judge adaptation",
            "case construction",
            "rebuttal strategy",
            "tournament preparation",
        ],
    },
    {
        "category": "sports",
        "label": "sports strategy or athlete training",
        "subtopics": [
            "soccer pressing systems",
            "basketball spacing",
            "tennis footwork",
            "baseball pitching routines",
            "swimming starts",
            "track relay exchanges",
            "volleyball rotations",
            "football play calling",
        ],
    },
    {
        "category": "culture",
        "label": "music, film, or internet culture",
        "subtopics": [
            "movie soundtracks",
            "streaming fandoms",
            "independent music scenes",
            "animation studios",
            "short-form video trends",
            "fashion cycles",
        ],
    },
    {
        "category": "food",
        "label": "food, restaurants, or cooking",
        "subtopics": [
            "street food markets",
            "pizza ovens",
            "school lunch design",
            "farmers markets",
            "coffee shops",
            "home baking",
        ],
    },
    {
        "category": "science",
        "label": "science, space, or medicine",
        "subtopics": [
            "moon missions",
            "sleep research",
            "ocean exploration",
            "vaccine delivery",
            "robotic surgery",
            "weather prediction",
        ],
    },
    {
        "category": "technology",
        "label": "technology and everyday gadgets",
        "subtopics": [
            "smart watches",
            "electric bikes",
            "phone cameras",
            "home robots",
            "battery design",
            "video game engines",
        ],
    },
    {
        "category": "travel",
        "label": "travel, cities, or public transportation",
        "subtopics": [
            "night trains",
            "airport design",
            "bike lanes",
            "city parks",
            "museum districts",
            "bus rapid transit",
        ],
    },
    {
        "category": "nature",
        "label": "nature, climate, or animals",
        "subtopics": [
            "coral reefs",
            "urban trees",
            "bird migration",
            "wildfire recovery",
            "rain gardens",
            "national parks",
        ],
    },
    {
        "category": "school",
        "label": "school life, clubs, or student habits",
        "subtopics": [
            "study groups",
            "school newspapers",
            "robotics clubs",
            "morning routines",
            "library design",
            "student leadership",
        ],
    },
    {
        "category": "business",
        "label": "business, startups, or unusual jobs",
        "subtopics": [
            "food trucks",
            "sports analytics firms",
            "small bookstores",
            "theme park designers",
            "sneaker resale shops",
            "local repair cafes",
        ],
    },
    {
        "category": "history",
        "label": "history, architecture, or museums",
        "subtopics": [
            "ancient roads",
            "train stations",
            "museum restoration",
            "castles",
            "public monuments",
            "historic neighborhoods",
        ],
    },
]


def _speed_fallback_passage(target_words: int) -> str:
    passage = " ".join(_FALLBACK_SENTENCES)
    while _word_count(passage) < target_words:
        passage = f"{passage} {passage}"
    return _fit_speed_passage_to_target(passage, target_words)


# ---------------------------------------------------------------------------
# Reading-accuracy helpers (mirror backend/app.py:250-267)
# ---------------------------------------------------------------------------


def normalize_words(text: str | None) -> list[str]:
    return re.findall(r"[a-z0-9']+", (text or "").lower())


def reading_match_counts(reference_text: str, spoken_text: str) -> tuple[int, int, int]:
    """Return matched, spoken, and reference word counts for speed scoring."""
    reference = normalize_words(reference_text)
    spoken = normalize_words(spoken_text)
    if not reference or not spoken:
        return (0, len(spoken), len(reference))
    matcher = SequenceMatcher(None, reference, spoken)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return (matched, len(spoken), len(reference))


def calculate_reading_accuracy(reference_text: str, spoken_text: str) -> float:
    """Returns a 0..1 accuracy score (matched words / spoken words)."""
    matched, spoken_count, _reference_count = reading_match_counts(
        reference_text, spoken_text
    )
    if spoken_count == 0:
        return 0.0
    return min(matched / spoken_count, 1.0)


# ---------------------------------------------------------------------------
# Drill generation
# ---------------------------------------------------------------------------


_DRILL_GUIDANCE = {
    "rebuttal": (
        "Create a compact debate argument for the user to rebut. Include a topic, side, "
        "and one paragraph argument with claim, warrant, and impact."
    ),
    "impact": (
        "Create one underdeveloped debate argument. The user must impact it out fully "
        "by explaining magnitude, probability, timeframe, and weighing."
    ),
    "contention": (
        "Use the provided debate resolution and side. The user must brainstorm as many "
        "contention taglines as possible, not full arguments."
    ),
}


def _speed_guidance(word_target: int, topic_area: str, subtopic: str) -> str:
    return (
        f"Create a short magazine-style speed-reading article about {subtopic} "
        f"within the broader area of {topic_area}. "
        f"It must be about {word_target} words total, readable aloud, and include "
        "varied punctuation so the user can practice pacing. The prompt must be the exact "
        "words the user should read aloud. The task must only tell the user to read the "
        "passage aloud; do not ask them to discuss, explain, write, or answer anything. "
        "Stay on the selected topic area instead of defaulting to debate or public speaking."
    )


async def _choose_speed_topic() -> dict[str, str | list[str]]:
    shuffled = list(_SPEED_TOPIC_AREAS)
    random.shuffle(shuffled)

    for topic in shuffled:
        try:
            count = await speed_passages.count_passages(str(topic["category"]))
        except Exception:
            count = 0
        if count < SPEED_PASSAGE_CATEGORY_LIMIT:
            return topic

    return random.choice(_SPEED_TOPIC_AREAS)


async def _json_from_model(messages: list[dict[str, str]], fallback: dict, max_tokens: int = 700) -> dict:
    try:
        response = await _openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            max_tokens=max_tokens,
            temperature=0.7,
            response_format={"type": "json_object"},
            messages=messages,
        )
        return json.loads(response.choices[0].message.content)
    except (json.JSONDecodeError, Exception):
        return fallback


_CONTENTION_TOPICS = [
    "Resolved: Schools should require financial literacy classes.",
    "Resolved: The federal government should ban single-use plastics.",
    "Resolved: Social media has done more harm than good.",
    "Resolved: Standardized testing should be abolished.",
]


async def generate_drill(drill_type: DrillType, timer_seconds: int | None = None) -> DrillPrompt:
    if drill_type not in DRILL_TITLES:
        raise ValueError("Unknown drill type.")

    timer = timer_seconds or 60

    if drill_type == "contention":
        topic = random.choice(_CONTENTION_TOPICS)
        side = random.choice(["affirmative", "negation"])
        return DrillPrompt(
            title=DRILL_TITLES["contention"],
            topic=topic,
            prompt=f"Side: {side}\nResolution: {topic}",
            task="List as many distinct contention taglines as you can. Do not write full warrants.",
            timer_seconds=timer,
        )

    if drill_type == "speed":
        word_target = speed_passage_word_target(timer)
        speed_topic = await _choose_speed_topic()
        speed_category = str(speed_topic["category"])
        speed_label = str(speed_topic["label"])
        speed_subtopic = random.choice(list(speed_topic["subtopics"]))
        try:
            category_count = await speed_passages.count_passages(speed_category)
            if category_count >= SPEED_PASSAGE_CATEGORY_LIMIT:
                cached_prompt = await speed_passages.get_passage(
                    word_target, speed_category
                )
                if cached_prompt and _looks_like_speed_passage(cached_prompt):
                    return DrillPrompt(
                        title=DRILL_TITLES["speed"],
                        topic=f"Speed Reading: {speed_label}",
                        prompt=_fit_speed_passage_to_target(cached_prompt, word_target),
                        task="Read the passage aloud, then submit your recording.",
                        timer_seconds=timer,
                    )
        except Exception:
            # Supabase passage reuse should never block drill generation.
            pass

        guidance = _speed_guidance(word_target, speed_label, str(speed_subtopic))
        fallback_prompt = _speed_fallback_passage(word_target)
        fallback_topic = f"Speed Reading: {speed_subtopic}"
        task = "Read the passage aloud, then submit your recording."
        max_tokens = 1400
    else:
        word_target = 0
        guidance = _DRILL_GUIDANCE[drill_type]
        fallback_prompt = (
            "Schools should require financial literacy because students need practical "
            "skills for adulthood."
        )
        fallback_topic = "Resolved: Schools should require financial literacy classes."
        task = "Give your response aloud, then submit your recording."
        max_tokens = 700

    fallback = {
        "title": DRILL_TITLES[drill_type],
        "topic": fallback_topic,
        "prompt": fallback_prompt,
        "task": task,
        "timer_seconds": timer,
    }

    drill = await _json_from_model(
        [
            {
                "role": "system",
                "content": (
                    "You create concise high school debate practice drills. Return only JSON "
                    "with keys: title, topic, prompt, task, timer_seconds. Make prompts specific, "
                    "clear, and useful for practice. For Speed Reading, prompt must be a read-aloud "
                    "passage, not an instruction or discussion question."
                ),
            },
            {"role": "user", "content": guidance},
        ],
        fallback,
        max_tokens=max_tokens,
    )

    title = DRILL_TITLES[drill_type]
    prompt_text = (drill.get("prompt") or fallback_prompt).strip()

    if drill_type == "speed":
        if not _looks_like_speed_passage(prompt_text):
            prompt_text = fallback_prompt
        prompt_text = _fit_speed_passage_to_target(prompt_text, word_target)
        try:
            await speed_passages.save_passage(
                word_target, prompt_text, speed_category, str(speed_subtopic)
            )
        except Exception:
            # A failed cache write should not make the user wait or fail the drill.
            pass

    return DrillPrompt(
        title=title,
        topic=(drill.get("topic") or fallback_topic).strip(),
        prompt=prompt_text,
        task=task,
        timer_seconds=timer,
    )


# ---------------------------------------------------------------------------
# Drill scoring (text)
# ---------------------------------------------------------------------------


_RUBRIC = {
    "rebuttal": "Judge whether the response directly answers the claim, warrant, and impact.",
    "impact": "Judge magnitude, probability, timeframe, weighing, and whether the impact chain is complete.",
    "contention": "Judge number, diversity, strategic usefulness, and whether taglines are distinct.",
    "speed": "Judge clarity and structure of the read-aloud delivery; do not score raw speed here.",
}


async def score_drill(
    drill_type: DrillType,
    drill: DrillPrompt | dict[str, Any],
    response_text: str,
) -> DrillScore:
    if drill_type not in DRILL_TITLES:
        raise ValueError("Unknown drill type.")

    drill_payload = drill.model_dump() if isinstance(drill, DrillPrompt) else dict(drill)

    fallback = DrillScore(
        score=0,
        feedback="Feedback unavailable. Try again with a fuller response.",
        strengths=[],
        improvements=["Try again with a fuller response."],
    )

    try:
        response = await _openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            max_tokens=700,
            temperature=0.4,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a debate coach scoring practice drills. Return only JSON with "
                        "keys: score (0-10 integer), feedback (string), strengths (array of "
                        "strings), improvements (array of strings). Keep feedback concrete."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Drill type: {DRILL_TITLES[drill_type]}\n"
                        f"Rubric: {_RUBRIC[drill_type]}\n"
                        f"Drill prompt: {json.dumps(drill_payload)}\n"
                        f"User response:\n{response_text}"
                    ),
                },
            ],
        )
        data = json.loads(response.choices[0].message.content)
        return DrillScore(
            score=int(data.get("score", 0)),
            feedback=str(data.get("feedback") or data.get("headline") or ""),
            strengths=list(data.get("strengths") or []),
            improvements=list(data.get("improvements") or []),
        )
    except Exception:
        return fallback


# ---------------------------------------------------------------------------
# AssemblyAI helpers (kept independent of A4; small duplication is OK)
# ---------------------------------------------------------------------------


async def transcribe_audio(
    audio_bytes: bytes,
    api_key: str,
    include_words: bool = False,
) -> tuple[str, float] | tuple[str, float, list[dict[str, int | str]]]:
    """Returns (transcript, duration_seconds). Duration may be 0 if unavailable."""
    headers = {"authorization": api_key}
    async with httpx.AsyncClient(timeout=120.0) as http:
        upload_resp = await http.post(
            f"{ASSEMBLYAI_BASE_URL}/upload",
            headers=headers,
            content=audio_bytes,
        )
        upload_resp.raise_for_status()
        upload_url = upload_resp.json()["upload_url"]

        start_resp = await http.post(
            f"{ASSEMBLYAI_BASE_URL}/transcript",
            headers={**headers, "content-type": "application/json"},
            json={"audio_url": upload_url, "speech_models": ["universal-2"]},
        )
        if start_resp.status_code >= 400:
            raise RuntimeError(
                f"Transcript creation failed: {start_resp.status_code} {start_resp.text}"
            )
        transcript_id = start_resp.json()["id"]

        poll_url = f"{ASSEMBLYAI_BASE_URL}/transcript/{transcript_id}"
        for _ in range(120):
            poll = await http.get(poll_url, headers=headers)
            poll.raise_for_status()
            data = poll.json()
            status = data.get("status")
            if status == "completed":
                duration_ms = data.get("audio_duration") or 0
                # AssemblyAI returns audio_duration in seconds (integer).
                if isinstance(duration_ms, (int, float)) and duration_ms > 1000:
                    duration_s = float(duration_ms) / 1000.0
                else:
                    duration_s = float(duration_ms)
                text = (data.get("text") or "").strip()
                if include_words:
                    return text, duration_s, list(data.get("words") or [])
                return text, duration_s
            if status == "error":
                raise RuntimeError(data.get("error") or "Transcription failed.")
            await _sleep(2.0)
    raise RuntimeError("Transcription timed out.")


async def _sleep(seconds: float) -> None:  # extracted so tests can patch it
    import asyncio

    await asyncio.sleep(seconds)


def compute_wpm(transcript: str, duration_seconds: float) -> int:
    words = len(normalize_words(transcript))
    seconds = max(duration_seconds, 1.0)
    return round((words / seconds) * 60)
