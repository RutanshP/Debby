"""AI generation helpers ported from backend/debby.py.

All functions use the shared AsyncOpenAI client from `services.openai_client`.
Prompt wording is preserved verbatim from the legacy implementation to keep
output behavior identical.
"""

from __future__ import annotations

import json
from typing import AsyncIterator, Literal

from models.flow import FlowBallot, WinnerVerdict
from services.openai_client import client

MODEL = "gpt-4o-mini-2024-07-18"

Side = Literal["aff", "neg"]


# --- internal helpers ---------------------------------------------------------


def _truncate_for_flow(text: str | None, limit: int = 1500) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


# --- speech generation --------------------------------------------------------


async def ai_speech(topic: str, side: Side = "aff") -> str:
    """One-shot AI debate speech (legacy `ai_speech` / `ai_response` starter).

    Defaults to the affirmative-constructive prompt used by legacy
    `ai_speech`. Passing `side="neg"` gives a negation opener — useful when
    the human picks AFF and Debby plays NEG with no transcript yet.
    """

    if side == "aff":
        system = (
            "You are an affirmative parliamentary debater by the name of Debby. "
            "You are required to make a debate case and complementary speech "
            "for the topic you are given."
        )
        user = (
            "Make a two minute affirmative speech using a high school "
            "parliamentary debate case format style with evidence at average "
            "speaking pace about the following topic: " + topic
            + ". In the start of your speech, you must say: \"Hello my name is Debby.\""
        )
    else:
        system = (
            "You are a negation parliamentary debater by the name of Debby. "
            "Your job is to make a debate case and a subsequent negation "
            "speech on the topic you are given."
        )
        user = (
            "Make a two minute negation speech on the topic: " + topic
            + " using a high school parliamentary debate case format style "
            "with evidence at average speaking pace. In the start of your "
            "speech, you must say: \"Hello my name is Debby.\""
        )

    message = await client.chat.completions.create(
        model=MODEL,
        max_tokens=512,
        temperature=0.0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return message.choices[0].message.content or ""


async def ai_response(topic: str, first_speech_transcription: str) -> str:
    """Negation response to a transcribed AFF constructive (non-streaming)."""

    message = await client.chat.completions.create(
        model=MODEL,
        max_tokens=512,
        temperature=0.0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a negation parliamentary debater by the name of "
                    "Debby. Your job is to make a debate case and a subsequent "
                    "negation speech on the topic you are given."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Given the following topic: \n" + topic
                    + "\nand also given the following affirmative speech: \n"
                    + first_speech_transcription
                    + "\nwrite a negation speech in the format of a high school "
                    "parliamentary debate case that lasts two minutes at average "
                    "speaking pace, and includes evidence. In the start of your "
                    "speech, you must say: \"Hello my name is Debby.\""
                ),
            },
        ],
    )
    return message.choices[0].message.content or ""


async def ai_response_stream(
    topic: str, first_speech_transcription: str
) -> AsyncIterator[str]:
    """Streaming variant of `ai_response`. Yields content chunks as strings."""

    stream = await client.chat.completions.create(
        model=MODEL,
        max_tokens=512,
        temperature=0.0,
        stream=True,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a negation parliamentary debater by the name of "
                    "Debby. Your job is to make a debate case and a subsequent "
                    "negation speech on the topic you are given."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Given the following topic: \n" + topic
                    + "\nand also given the following affirmative speech: \n"
                    + first_speech_transcription
                    + "\nwrite a negation speech in the format of a high school "
                    "parliamentary debate case that lasts two minutes at average "
                    "speaking pace, and includes evidence. In the start of your "
                    "speech, you must say: \"Hello my name is Debby.\""
                ),
            },
        ],
    )

    async for chunk in stream:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        token = getattr(delta, "content", None) if delta is not None else None
        if token:
            yield token


# --- judgment -----------------------------------------------------------------


_WINNER_SYSTEM = (
    "You are the judge of a parliamentary-formatted debate. You will be given "
    "a for speech constructive, an against speech, and then a for speech "
    "rebuttal. You must decide a winner based on the strength of each case "
    "and the refutations of the speech. "
    "Return JSON with two keys: winner_side (either \"aff\" or \"neg\") and "
    "rfd (the reason for decision text). "
    "Criteria: First, if the negation did not fully refute all of the "
    "affirmation's points, the affirmation should win. Second, there must be "
    "evidence-based warranting for each point — statistics, link chains, "
    "examples, or quotes from academia. If no evidence, weigh the point less "
    "unless it has solid logical backing. Third, no pre-disposed bias for "
    "either side. Finally, use impact analysis: whichever side provides "
    "better impacts (measured by how many people they affect — healthcare, "
    "environment, economy) wins. If neither side provides impacts, default to "
    "the negation. Either side may bring up impacts implicitly."
)


async def winner(
    first_speech_transcription: str,
    against_speech: str,
    second_speech_transcription: str,
    topic: str,
) -> WinnerVerdict:
    """Structured judge verdict.

    Raises ValueError if any speech is missing (matches legacy contract) and
    re-raises a clear error on malformed model output.
    """

    if not (first_speech_transcription and against_speech and second_speech_transcription):
        raise ValueError(
            "Both speeches and AI response are required for winner determination!"
        )

    response = await client.chat.completions.create(
        model=MODEL,
        max_tokens=512,
        temperature=0.0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _WINNER_SYSTEM},
            {
                "role": "user",
                "content": (
                    "Given the following topic: \n" + topic
                    + "\nand given the following for speech constructive: \n"
                    + first_speech_transcription
                    + "\nand given the following against speech: \n"
                    + against_speech
                    + "\nand given the following for speech rebuttal: \n"
                    + second_speech_transcription
                    + "\nDecide a winner and return JSON: "
                    "{\"winner_side\": \"aff\" | \"neg\", \"rfd\": \"...\"}. "
                    "The rfd should explain impact analysis and why the "
                    "winning side has bigger impacts."
                ),
            },
        ],
    )

    raw = response.choices[0].message.content or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"winner: malformed JSON from model: {raw!r}") from exc

    # Tolerate a couple of legacy aliases.
    if "winner_side" not in data and "winner" in data:
        data["winner_side"] = data["winner"]
    side_val = str(data.get("winner_side", "")).strip().lower()
    if side_val in ("for", "affirmation", "affirmative"):
        side_val = "aff"
    elif side_val in ("against", "negation", "negative"):
        side_val = "neg"
    data["winner_side"] = side_val

    return WinnerVerdict.model_validate(data)


# --- flow generation ----------------------------------------------------------


_FLOW_SYSTEM = (
    "You create compact parliamentary debate flow sheets as JSON. "
    "Return JSON only with keys: aff_sheet, neg_sheet, ballot, dropped, voters, recommended_drills. "
    "aff_sheet: max 4 rows. Each row has contention, neg_responses, aff_defense, status, judge_note. "
    "The aff sheet must flow AFF contention -> NEG responses -> AFF defense. "
    "If a NEG contention directly answers or turns an AFF contention, include that NEG contention "
    "inside neg_responses on the matching AFF row too. "
    "neg_sheet: max 4 rows. Each row has contention, aff_rebuttals, status, judge_note. "
    "The neg sheet must flow NEG contention -> AFF rebuttals. "
    "If the AFF rebuttal directly answers a NEG contention, include it in aff_rebuttals even if it "
    "is phrased as defense of the original AFF case. "
    "Only mark a response/rebuttal empty when there is no direct or implicit clash in the later speech. "
    "contention/responses/rebuttals/defense objects use tag and summary only. "
    "Do not create placeholder responses, rebuttals, or defenses. If no later answer exists, "
    "use an empty array; the app already has fixed wording for missing cells. "
    "tag <= 8 words. summary <= 18 words. status must be unrefuted, refuted, or contested. "
    "Mark a contention unrefuted only when the opposing side did not answer it. "
    "ballot has aff_unrefuted, neg_unrefuted, winner, explanation. "
    "Winner must be the side with more unrefuted contentions; if tied, use impact weighing from the RFD. "
    "ballot winner must be aff or neg; explanation <= 35 words. "
    "dropped max 4. voters max 3. Each voter winner must be aff or neg. "
    "recommended_drills can only include: rebuttal, impact, contentions, speed. "
    "Do not quote long text."
)


async def generate_round_flow(
    topic: str,
    aff_speech: str,
    neg_speech: str,
    aff_rebuttal: str,
    rfd: str,
) -> FlowBallot:
    """Produce a structured flow ballot. Raises ValueError on bad JSON."""

    response = await client.chat.completions.create(
        model=MODEL,
        max_tokens=850,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _FLOW_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Topic: {_truncate_for_flow(topic, 300)}\n\n"
                    f"AFF CONSTRUCTIVE:\n{_truncate_for_flow(aff_speech)}\n\n"
                    f"NEG SPEECH:\n{_truncate_for_flow(neg_speech)}\n\n"
                    f"AFF REBUTTAL:\n{_truncate_for_flow(aff_rebuttal)}\n\n"
                    f"JUDGE RFD:\n{_truncate_for_flow(rfd, 1200)}"
                ),
            },
        ],
    )

    raw = response.choices[0].message.content or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"generate_round_flow: malformed JSON from model: {raw!r}") from exc

    # Trim to legacy caps before validation.
    if isinstance(data, dict):
        if isinstance(data.get("aff_sheet"), list):
            data["aff_sheet"] = data["aff_sheet"][:4]
        if isinstance(data.get("neg_sheet"), list):
            data["neg_sheet"] = data["neg_sheet"][:4]
        if isinstance(data.get("dropped"), list):
            data["dropped"] = data["dropped"][:4]
        if isinstance(data.get("voters"), list):
            data["voters"] = data["voters"][:3]
        if isinstance(data.get("recommended_drills"), list):
            data["recommended_drills"] = data["recommended_drills"][:4]

    return FlowBallot.model_validate(data)
