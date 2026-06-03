"""AI generation helpers ported from backend/debby.py.

All functions use the shared AsyncOpenAI client from `services.openai_client`.
Prompt wording is preserved verbatim from the legacy implementation to keep
output behavior identical.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator, Literal

from models.flow import FlowBallot, WinnerVerdict
from services import evidence as evidence_service
from services.openai_client import client

MODEL = "gpt-4o-mini-2024-07-18"
JUDGE_MODEL = "gpt-5.4-mini"
JUDGE_FALLBACK_MODEL = MODEL
SPOKEN_PROSE_ONLY = (
    "Write plain spoken prose only. Do not use markdown, bullet points, "
    "asterisks, headings, or numbered lists."
)
NO_FAKE_EVIDENCE = (
    "Do not invent studies, statistics, source names, expert quotes, or "
    "historical examples. If no reliable evidence is supplied, use logical "
    "warranting instead of fabricated factual claims."
)

Side = Literal["aff", "neg"]


# --- internal helpers ---------------------------------------------------------


def _truncate_for_flow(text: str | None, limit: int = 1500) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _short_words(text: str, limit: int, fallback: str) -> str:
    words = (text or "").strip().split()
    if not words:
        return fallback
    return " ".join(words[:limit])


_TOPIC_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "than",
    "that",
    "the",
    "their",
    "this",
    "to",
    "us",
    "with",
}


def _content_words(text: str) -> set[str]:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in text)
    return {
        word
        for word in cleaned.split()
        if len(word) > 2 and word not in _TOPIC_STOPWORDS
    }


def _is_topic_restatement(item: dict[str, Any], topic: str) -> bool:
    topic_words = _content_words(topic)
    item_words = _content_words(
        f"{item.get('tag', '')} {item.get('summary', '')}"
    )
    if not topic_words or not item_words:
        return False

    overlap = len(item_words & topic_words) / max(len(item_words), 1)
    unique_words = item_words - topic_words
    return overlap >= 0.7 and len(unique_words) <= 1


def _winner_side_from_text(value: Any, fallback: Side = "neg") -> Side:
    side = str(value or "").strip().lower()
    if side in ("aff", "for", "affirmation", "affirmative", "pro"):
        return "aff"
    if side in ("neg", "against", "negation", "negative", "con"):
        return "neg"
    return fallback


def _flow_item(value: Any, fallback_tag: str = "Untitled") -> dict[str, Any]:
    if isinstance(value, str):
        text = value.strip()
        return {
            "tag": _short_words(text, 8, fallback_tag),
            "summary": _short_words(text, 18, "Open transcripts for details."),
        }

    if isinstance(value, dict):
        tag = value.get("tag") or value.get("title") or value.get("claim")
        summary = (
            value.get("summary")
            or value.get("reason")
            or value.get("content")
            or value.get("text")
            or value.get("argument")
        )
        if not tag and isinstance(summary, str):
            tag = _short_words(summary, 8, fallback_tag)
        if not summary and isinstance(tag, str):
            summary = tag
        item: dict[str, Any] = {
            "tag": str(tag or fallback_tag),
            "summary": str(summary or "Open transcripts for details."),
        }
        if "refuted" in value:
            item["refuted"] = value.get("refuted")
        return item

    return {"tag": fallback_tag, "summary": "Open transcripts for details."}


def _flow_items(value: Any, fallback_tag: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [_flow_item(item, fallback_tag) for item in value]
    return [_flow_item(value, fallback_tag)]


def _row_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    if status in ("unrefuted", "refuted", "contested"):
        return status
    return "contested"


def _normalize_sheet_row(row: Any, side: Side) -> dict[str, Any]:
    row = row if isinstance(row, dict) else {"contention": row}
    contention = row.get("contention") or row.get("root") or row.get("claim")
    normalized: dict[str, Any] = {
        "contention": _flow_item(
            contention,
            "Aff contention" if side == "aff" else "Neg contention",
        ),
        "status": _row_status(row.get("status")),
        "judge_note": str(row.get("judge_note") or "No judge note generated."),
    }

    if side == "aff":
        neg_responses = (
            row.get("neg_responses")
            or row.get("responses")
            or row.get("neg_rebuttals")
            or row.get("answers")
        )
        aff_defense = (
            row.get("aff_defense")
            or row.get("defense")
            or row.get("aff_responses")
            or row.get("aff_rebuttals")
        )
        normalized["neg_responses"] = _flow_items(neg_responses, "Neg response")
        normalized["aff_defense"] = _flow_items(aff_defense, "Aff defense")
    else:
        aff_rebuttals = (
            row.get("aff_rebuttals")
            or row.get("rebuttals")
            or row.get("aff_responses")
            or row.get("responses")
            or row.get("defense")
        )
        normalized["aff_rebuttals"] = _flow_items(aff_rebuttals, "Aff rebuttal")

    return normalized


def _normalize_flow_data(
    data: Any,
    rfd: str,
    topic: str = "",
    speech_metrics: Any | None = None,
) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("generate_round_flow: model did not return a JSON object")

    aff_sheet = data.get("aff_sheet") if isinstance(data.get("aff_sheet"), list) else []
    neg_sheet = data.get("neg_sheet") if isinstance(data.get("neg_sheet"), list) else []
    aff_rows = [
        row
        for row in (_normalize_sheet_row(row, "aff") for row in aff_sheet[:4])
        if not _is_topic_restatement(row["contention"], topic)
    ]
    neg_rows = [
        row
        for row in (_normalize_sheet_row(row, "neg") for row in neg_sheet[:4])
        if not _is_topic_restatement(row["contention"], topic)
    ]

    ballot = data.get("ballot") if isinstance(data.get("ballot"), dict) else {}
    winner = _winner_side_from_text(
        ballot.get("winner"),
        _winner_side_from_text(data.get("winner")),
    )
    aff_unrefuted = ballot.get("aff_unrefuted")
    neg_unrefuted = ballot.get("neg_unrefuted")
    if not isinstance(aff_unrefuted, int):
        aff_unrefuted = sum(1 for row in aff_rows if row["status"] == "unrefuted")
    if not isinstance(neg_unrefuted, int):
        neg_unrefuted = sum(1 for row in neg_rows if row["status"] == "unrefuted")

    voters = data.get("voters") if isinstance(data.get("voters"), list) else []
    normalized_voters = []
    for voter in voters[:3]:
        if isinstance(voter, str):
            normalized_voters.append(
                {
                    "tag": _short_words(voter, 8, "Winning impact"),
                    "winner": winner,
                    "reason": voter,
                }
            )
        elif isinstance(voter, dict):
            normalized_voters.append(
                {
                    "tag": str(
                        voter.get("tag")
                        or voter.get("title")
                        or "Winning contention / impact"
                    ),
                    "winner": _winner_side_from_text(voter.get("winner"), winner),
                    "reason": str(voter.get("reason") or voter.get("summary") or ""),
                }
            )

    drills = (
        data.get("recommended_drills")
        if isinstance(data.get("recommended_drills"), list)
        else []
    )
    allowed_drills = {"rebuttal", "impact", "contentions", "speed", "filler"}
    recommended_drills = [
        str(drill).strip().lower()
        for drill in drills[:4]
        if str(drill).strip().lower() in allowed_drills
    ]
    if _has_filler_issue(speech_metrics) and "filler" not in recommended_drills:
        if len(recommended_drills) >= 4:
            recommended_drills = recommended_drills[:3]
        recommended_drills.append("filler")

    return {
        "aff_sheet": aff_rows,
        "neg_sheet": neg_rows,
        "ballot": {
            "aff_unrefuted": aff_unrefuted,
            "neg_unrefuted": neg_unrefuted,
            "winner": winner,
            "explanation": str(ballot.get("explanation") or _truncate_for_flow(rfd, 180)),
        },
        "dropped": _flow_items(data.get("dropped"), "Dropped argument")[:4],
        "voters": normalized_voters,
        "recommended_drills": recommended_drills[:4],
    }


def _has_filler_issue(speech_metrics: Any | None) -> bool:
    if not isinstance(speech_metrics, dict):
        return False
    for value in speech_metrics.values():
        if not isinstance(value, dict):
            continue
        count = int(value.get("filler_count") or 0)
        pause_count = int(value.get("major_pause_count") or 0)
        per_minute = float(value.get("filler_per_minute") or 0)
        if count >= 3 or per_minute >= 4 or pause_count >= 2:
            return True
    return False


# --- speech generation --------------------------------------------------------


async def ai_neg_framework(topic: str) -> str:
    """Negative constructive case body only, generated from the topic."""

    grounding = await evidence_service.get_prompt_block(topic, "neg")

    system = (
        "You are a negation parliamentary debater by the name of Debby. "
        "Your job is to make a debate case for the topic you are given. "
        + SPOKEN_PROSE_ONLY
        + " "
        + NO_FAKE_EVIDENCE
    )
    user = (
        "Make the body of a two-minute negation constructive case for the topic: "
        + topic
        + " using a high school parliamentary debate case format style with evidence "
        "at average speaking pace. Include exactly three negative contentions with "
        "clear labels, warranting, and impacts. This is only the first part of one "
        "continuous negative speech, and a later paragraph will refute the "
        "affirmative. Do NOT include a conclusion, summary paragraph, thank-you, "
        "judge appeal, or any closing/wrap-up sentence. After the third contention, "
        "end with a brief transition into the upcoming refutation section rather "
        "than ending the speech. In the start of your speech, you "
        'must say: "Hello my name is Debby."\n\n'
        + grounding
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


async def ai_neg_rebuttal(topic: str, neg_case: str, aff_speech: str) -> str:
    """Append-only negative rebuttal paragraph plus conclusion."""

    if not topic or not neg_case or not aff_speech:
        raise ValueError("Topic, neg case, and aff speech are required")

    system = (
        "You are a negation parliamentary debater by the name of Debby. "
        "You have already delivered your negative constructive case. "
        "Your job is to add only the very next paragraph to that speech. "
        + SPOKEN_PROSE_ONLY
    )
    user = (
        "Given the following topic:\n"
        + topic
        + "\n\nYou have already delivered this negative case:\n"
        + neg_case
        + "\n\nThe affirmative gave the following speech:\n"
        + aff_speech
        + "\n\nWrite ONLY the next paragraph that comes after your case above. "
        "This paragraph must: refute the affirmative's major contentions, "
        "cross-apply your prepared case contentions by name as refutations where "
        "they apply, and end with a brief conclusion. "
        "Do NOT restate or summarize your case contentions. "
        "Do NOT include a greeting. Output only this single paragraph."
    )

    message = await client.chat.completions.create(
        model=MODEL,
        max_tokens=350,
        temperature=0.0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return message.choices[0].message.content or ""


async def ai_aff_overview(topic: str, aff_speech: str) -> str:
    """One-paragraph roadmap of Debby's affirmative constructive."""

    if not topic or not aff_speech:
        raise ValueError("Topic and affirmative speech are required")

    system = (
        "You are an affirmative parliamentary debater by the name of Debby. "
        "Your job is to deliver a brief overview of the affirmative case. "
        + SPOKEN_PROSE_ONLY
    )
    user = (
        "Given the following topic:\n"
        + topic
        + "\n\nGiven Debby's affirmative constructive speech:\n"
        + aff_speech
        + "\n\nWrite exactly one paragraph that previews and roadmaps the "
        "affirmative's contentions from that speech. Do not include a greeting. "
        "Do not make any rebuttal. Output only this single overview paragraph."
    )

    message = await client.chat.completions.create(
        model=MODEL,
        max_tokens=250,
        temperature=0.0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return message.choices[0].message.content or ""


async def ai_speech(topic: str, side: Side = "aff") -> str:
    """One-shot AI debate speech (legacy `ai_speech` / `ai_response` starter).

    Defaults to the affirmative-constructive prompt used by legacy
    `ai_speech`. Passing `side="neg"` gives a negation opener — useful when
    the human picks AFF and Debby plays NEG with no transcript yet.
    """

    grounding = await evidence_service.get_prompt_block(topic, side)
    if side == "aff":
        system = (
            "You are an affirmative parliamentary debater by the name of Debby. "
            "You are required to make a debate case and complementary speech "
            "for the topic you are given. "
            + SPOKEN_PROSE_ONLY
            + " "
            + NO_FAKE_EVIDENCE
        )
        user = (
            "Make a two minute affirmative speech using a high school "
            "parliamentary debate case format style with evidence at average "
            "speaking pace about the following topic: " + topic
            + '. In the start of your speech, you must say: "Hello my name is Debby."\n\n'
            + grounding
        )
    else:
        system = (
            "You are a negation parliamentary debater by the name of Debby. "
            "Your job is to make a debate case and a subsequent negation "
            "speech on the topic you are given. "
            + SPOKEN_PROSE_ONLY
            + " "
            + NO_FAKE_EVIDENCE
        )
        user = (
            "Make a two minute negation speech on the topic: " + topic
            + " using a high school parliamentary debate case format style "
            "with evidence at average speaking pace. In the start of your "
            'speech, you must say: "Hello my name is Debby."\n\n'
            + grounding
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

    grounding = await evidence_service.get_prompt_block(topic, "neg")

    message = await client.chat.completions.create(
        model=MODEL,
        max_tokens=700,
        temperature=0.0,
        messages=[
            {
                "role": "system",
                "content": (
                "You are a negation parliamentary debater by the name of "
                "Debby. Your job is to make a debate case and a subsequent "
                "negation speech on the topic you are given. "
                + SPOKEN_PROSE_ONLY
                + " "
                + NO_FAKE_EVIDENCE
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
                    "speaking pace, and includes evidence. Structure it as: first, "
                    "present Debby's own negative contentions; second, refute the "
                    "affirmative's major contentions. Only refute arguments that "
                    "appear in the transcript. Do not invent likely affirmative "
                    "arguments. When one of Debby's own "
                    "contentions answers an affirmative point, explicitly cross-apply "
                    "it as a refutation. For example, say that your money tradeoff "
                    "contention also refutes their innovation point because that money "
                    "can fund innovation elsewhere. Use clear signposting. In the "
                    "start of your speech, you must say: \"Hello my name is Debby.\" "
                    + SPOKEN_PROSE_ONLY
                    + "\n\n"
                    + grounding
                ),
            },
        ],
    )
    return message.choices[0].message.content or ""


async def ai_aff_rebuttal(topic: str, aff_speech: str, neg_speech: str) -> str:
    """Single affirmative rebuttal speech after the human gives the NEG speech."""

    if not topic or not aff_speech or not neg_speech:
        raise ValueError("Topic, affirmative speech, and negative speech are required")

    message = await client.chat.completions.create(
        model=MODEL,
        max_tokens=450,
        temperature=0.0,
        messages=[
            {
                "role": "system",
                "content": (
                "You are an affirmative parliamentary debater by the name of "
                "Debby. You are giving your second affirmative speech. "
                "Do not introduce a new constructive case. Do not include a "
                "greeting. " + SPOKEN_PROSE_ONLY + " " + NO_FAKE_EVIDENCE
            ),
        },
        {
                "role": "user",
                "content": (
                    "Given the following topic:\n"
                    + topic
                    + "\n\nGiven Debby's affirmative constructive speech:\n"
                    + aff_speech
                    + "\n\nGiven the negative speech:\n"
                    + neg_speech
                    + "\n\nWrite ONE concise affirmative rebuttal speech. First rebut "
                    "the negative's strongest actual arguments, extend the "
                    "affirmative's best offense, and do clear impact comparison. "
                    "Then give a very brief overview that emphasizes the affirmative "
                    "contention that was least refuted by the negative. Do not invent "
                    "detailed negative arguments that were not actually made. Do not "
                    "include a new case or a greeting. Do not introduce new outside "
                    "evidence that was not already in the earlier affirmative speech. "
                    "Output only this single speech."
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
        max_tokens=700,
        temperature=0.0,
        stream=True,
        messages=[
            {
                "role": "system",
                "content": (
                "You are a negation parliamentary debater by the name of "
                "Debby. Your job is to make a debate case and a subsequent "
                "negation speech on the topic you are given. "
                + SPOKEN_PROSE_ONLY
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
                    "speaking pace, and includes evidence. Structure it as: first, "
                    "present Debby's own negative contentions; second, refute the "
                    "affirmative's major contentions. Only refute arguments that "
                    "appear in the transcript. Do not invent likely affirmative "
                    "arguments. When one of Debby's own "
                    "contentions answers an affirmative point, explicitly cross-apply "
                    "it as a refutation. For example, say that your money tradeoff "
                    "contention also refutes their innovation point because that money "
                    "can fund innovation elsewhere. Use clear signposting. In the "
                    "start of your speech, you must say: \"Hello my name is Debby.\" "
                    + SPOKEN_PROSE_ONLY
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


async def _chat_completion_stream(
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    temperature: float = 0.0,
) -> AsyncIterator[str]:
    stream = await client.chat.completions.create(
        model=MODEL,
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True,
        messages=messages,
    )

    async for chunk in stream:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        token = getattr(delta, "content", None) if delta is not None else None
        if token:
            yield token


async def ai_speech_stream(topic: str, side: Side = "aff") -> AsyncIterator[str]:
    grounding = await evidence_service.get_prompt_block(topic, side)
    if side == "aff":
        messages = [
            {
                "role": "system",
                "content": (
                    "You are an affirmative parliamentary debater by the name of Debby. "
                    "You are required to make a debate case and complementary speech "
                    "for the topic you are given. "
                    + SPOKEN_PROSE_ONLY
                    + " "
                    + NO_FAKE_EVIDENCE
                ),
            },
            {
                "role": "user",
                "content": (
                    "Make a two minute affirmative speech using a high school "
                    "parliamentary debate case format style with evidence at average "
                    "speaking pace about the following topic: "
                    + topic
                    + '. In the start of your speech, you must say: "Hello my name is Debby."\n\n'
                    + grounding
                ),
            },
        ]
    else:
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a negation parliamentary debater by the name of Debby. "
                    "Your job is to make a debate case and a subsequent negation "
                    "speech on the topic you are given. "
                    + SPOKEN_PROSE_ONLY
                    + " "
                    + NO_FAKE_EVIDENCE
                ),
            },
            {
                "role": "user",
                "content": (
                    "Make a two minute negation speech on the topic: "
                    + topic
                    + " using a high school parliamentary debate case format style "
                    "with evidence at average speaking pace. In the start of your "
                    'speech, you must say: "Hello my name is Debby."\n\n'
                    + grounding
                ),
            },
        ]

    async for token in _chat_completion_stream(messages, max_tokens=512):
        yield token


async def ai_neg_framework_stream(topic: str) -> AsyncIterator[str]:
    grounding = await evidence_service.get_prompt_block(topic, "neg")
    messages = [
        {
            "role": "system",
            "content": (
                "You are a negation parliamentary debater by the name of Debby. "
                "Your job is to make a debate case for the topic you are given. "
                + SPOKEN_PROSE_ONLY
                + " "
                + NO_FAKE_EVIDENCE
            ),
        },
        {
            "role": "user",
            "content": (
                "Make the body of a two-minute negation constructive case for the topic: "
                + topic
                + " using a high school parliamentary debate case format style with evidence "
                "at average speaking pace. Include exactly three negative contentions with "
                "clear labels, warranting, and impacts. This is only the first part of one "
                "continuous negative speech, and a later paragraph will refute the "
                "affirmative. Do NOT include a conclusion, summary paragraph, thank-you, "
                "judge appeal, or any closing/wrap-up sentence. After the third contention, "
                "end with a brief transition into the upcoming refutation section rather "
                'than ending the speech. In the start of your speech, you must say: "Hello my name is Debby."\n\n'
                + grounding
            ),
        },
    ]

    async for token in _chat_completion_stream(messages, max_tokens=512):
        yield token


async def ai_neg_rebuttal_stream(
    topic: str, neg_case: str, aff_speech: str
) -> AsyncIterator[str]:
    if not topic or not neg_case or not aff_speech:
        raise ValueError("Topic, neg case, and aff speech are required")

    messages = [
        {
            "role": "system",
            "content": (
                "You are a negation parliamentary debater by the name of Debby. "
                "You have already delivered your negative constructive case. "
                "Your job is to add only the very next paragraph to that speech. "
                + SPOKEN_PROSE_ONLY
                + " "
                + NO_FAKE_EVIDENCE
            ),
        },
        {
            "role": "user",
            "content": (
                "Given the following topic:\n"
                + topic
                + "\n\nYou have already delivered this negative case:\n"
                + neg_case
                + "\n\nThe affirmative gave the following speech:\n"
                + aff_speech
                + "\n\nWrite ONLY the next paragraph that comes after your case above. "
                "This paragraph must: refute the affirmative's major contentions, "
                "cross-apply your prepared case contentions by name as refutations where "
                "they apply, and end with a brief conclusion. "
                "Do NOT restate or summarize your case contentions. "
                "Do NOT include a greeting. Do not introduce new outside evidence "
                "not already present in your negative case. Output only this single paragraph."
            ),
        },
    ]

    async for token in _chat_completion_stream(messages, max_tokens=350):
        yield token


async def ai_aff_rebuttal_stream(
    topic: str, aff_speech: str, neg_speech: str
) -> AsyncIterator[str]:
    if not topic or not aff_speech or not neg_speech:
        raise ValueError("Topic, affirmative speech, and negative speech are required")

    messages = [
        {
            "role": "system",
            "content": (
                "You are an affirmative parliamentary debater by the name of Debby. "
                "You are giving your second affirmative speech. "
                "Do not introduce a new constructive case. Do not include a greeting. "
                + SPOKEN_PROSE_ONLY
                + " "
                + NO_FAKE_EVIDENCE
            ),
        },
        {
            "role": "user",
            "content": (
                "Given the following topic:\n"
                + topic
                + "\n\nGiven Debby's affirmative constructive speech:\n"
                + aff_speech
                + "\n\nGiven the negative speech:\n"
                + neg_speech
                + "\n\nWrite ONE concise affirmative rebuttal speech. First rebut "
                "the negative's strongest actual arguments, extend the "
                "affirmative's best offense, and do clear impact comparison. "
                "Then give a very brief overview that emphasizes the affirmative "
                "contention that was least refuted by the negative. Do not invent "
                "detailed negative arguments that were not actually made. Do not "
                "include a new case or a greeting. Do not introduce new outside "
                "evidence that was not already in the earlier affirmative speech. "
                "Output only this single speech."
            ),
        },
    ]

    async for token in _chat_completion_stream(messages, max_tokens=450):
        yield token


# --- judgment -----------------------------------------------------------------


_WINNER_SYSTEM = (
    "You are the judge of a parliamentary-formatted debate. You will be given "
    "a for speech constructive, an against speech, and then a for speech "
    "rebuttal. You must decide a winner based on the strength of each case "
    "and the refutations of the speech. "
    "Return JSON with two keys: winner_side (either \"aff\" or \"neg\") and "
    "rfd (the reason for decision text). The RFD is not a flow sheet. Do not "
    "include the full flow, every contention, aff_sheet, neg_sheet, or a "
    "speech-by-speech recap. Give a qualified, nuanced decision in 4-5 short "
    "labeled lines: 'Decision: ...', 'Key clash: ...', 'Refutation quality: ...', "
    "'Impact weighing: ...', and optional 'Dropped/residual offense: ...'. "
    "Total RFD length must be under 220 words. "
    "Before deciding, check whether each side made at least one topical, "
    "judgeable contention. A judgeable contention must contain a claim plus "
    "some warrant, reason, mechanism, evidence, or impact. Merely repeating "
    "the topic/resolution, naming an actor, or saying one side is a greater "
    "threat is not a contention. Do not infer, repair, or invent missing "
    "arguments from incoherent or off-topic speech. Only credit arguments that "
    "are actually present in the transcript. If the affirmative constructive "
    "does not make a topical judgeable contention, the affirmative cannot win "
    "on case offense or dropped arguments. If both sides are incoherent or "
    "off-topic, return winner_side \"neg\" only as the procedural default and "
    "make the RFD say that no side made a judgeable topical argument. "
    "Dropped arguments matter, but a dropped contention is not an automatic "
    "win. If a contention flows through, still evaluate its warrant quality, "
    "link strength, probability, magnitude, timeframe, and comparison against "
    "the opponent's offense. A weak dropped argument with tiny or speculative "
    "impacts can lose to a better-warranted contested argument. Refutation is "
    "not binary. Evaluate whether each answer fully refutes, partially "
    "refutes, mitigates, turns, or merely asserts against the original point. "
    "When a response only partially refutes a contention, preserve the "
    "remaining offense and weigh the reduced/residual impact. If a response "
    "claims an impact is possible, such as possible misuse, factor in the "
    "probability and warranting of that misuse before assigning weight. "
    "Criteria: There must be evidence-based warranting for each point — "
    "statistics, link chains, examples, or quotes from academia. If no "
    "evidence, weigh the point less unless it has solid logical backing. "
    "No pre-disposed bias for either side. Finally, use impact analysis: "
    "weigh probability, magnitude, timeframe, reversibility, and directness "
    "of the link chain. If neither side provides impacts, default to the "
    "negation. Either side may bring up impacts implicitly."
)


def _judge_request_options(model: str) -> dict[str, Any]:
    if model.startswith("gpt-5"):
        return {"max_completion_tokens": 2000, "reasoning_effort": "low"}
    return {"max_tokens": 900, "temperature": 0.0}


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

    messages = [
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
                "The rfd should explain the decisive clash, qualify the "
                "strength of the key refutations, identify any dropped or "
                "residual offense, and compare impacts after accounting for "
                "partial refutation/residual offense. "
                "Put detailed flow information only in the separate flow JSON, "
                "not in the RFD. Do not use any contention that is merely a "
                "restatement of the topic or that is not actually present in "
                "the transcript."
            ),
        },
    ]

    raw = ""
    for model in (JUDGE_MODEL, JUDGE_FALLBACK_MODEL):
        response = await client.chat.completions.create(
            model=model,
            **_judge_request_options(model),
            response_format={"type": "json_object"},
            messages=messages,
        )
        raw = response.choices[0].message.content or ""
        if raw.strip():
            break

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
    "A contention must include a claim plus a warrant, mechanism, reason, "
    "evidence, or impact from the transcript. Do not treat the topic, "
    "resolution, side statement, actor name, or comparison phrase as a "
    "contention. For example, 'greater threat to the US than Iran' is only a "
    "restatement unless the speech gives a real reason why. If a speech has no "
    "judgeable topical contention, leave that side's sheet empty. "
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
    "Use contested when a response partially refutes, mitigates, turns, or weakens "
    "a contention but leaves residual offense. judge_note must explain the degree "
    "of refutation and any remaining impact weight. Do not treat dropped arguments "
    "as automatic winners; still evaluate their warrant quality, link strength, "
    "probability, magnitude, timeframe, and comparison against opposing offense. "
    "When a response says an impact is merely possible, such as possible misuse, "
    "judge_note must account for the probability and warranting of that risk. "
    "ballot has aff_unrefuted, neg_unrefuted, winner, explanation. "
    "Winner must be based on comparative impact weighing, including dropped arguments, "
    "partial refutations, residual offense, probability, magnitude, timeframe, and link quality; "
    "do not decide only by counting unrefuted contentions. "
    "ballot winner must be aff or neg; explanation <= 35 words. "
    "dropped max 4. voters max 3. Each voter winner must be aff or neg. "
    "recommended_drills can only include: rebuttal, impact, contentions, speed, filler. "
    "Recommend filler when speech metrics show frequent filler words or major pauses. "
    "Do not quote long text."
)


async def generate_round_flow(
    topic: str,
    aff_speech: str,
    neg_speech: str,
    aff_rebuttal: str,
    rfd: str,
    speech_metrics: Any | None = None,
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
                    f"JUDGE RFD:\n{_truncate_for_flow(rfd, 1200)}\n\n"
                    f"SPEECH METRICS:\n{json.dumps(speech_metrics or {}, default=str)}"
                ),
            },
        ],
    )

    raw = response.choices[0].message.content or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"generate_round_flow: malformed JSON from model: {raw!r}") from exc

    return FlowBallot.model_validate(
        _normalize_flow_data(data, rfd, topic, speech_metrics)
    )
