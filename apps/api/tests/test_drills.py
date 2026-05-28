"""Tests for the drills service + routes (A5)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import httpx
import respx
from fastapi.testclient import TestClient

from main import app
from models.drill import DrillPrompt
from routes import drills as drills_route
from services import drills as drills_service

# Override the real Supabase JWT verification with a stub user so route
# tests don't have to mint real tokens. The `authed_user` fixture
# turns the override on (and removes it on teardown) so tests that
# need a 401 path can run unauthenticated.
from deps.auth import User, get_current_user as _real_get_current_user


async def _fake_current_user() -> User:
    return User(id="00000000-0000-0000-0000-000000000001", email="t@example.com")


@pytest.fixture
def authed_user():
    app.dependency_overrides[_real_get_current_user] = _fake_current_user
    try:
        yield
    finally:
        app.dependency_overrides.pop(_real_get_current_user, None)


def _mock_chat_completion(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))]
    )


# ---------------------------------------------------------------------------
# Service: generation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "drill_type,payload",
    [
        (
            "rebuttal",
            {
                "title": "Rebuttal Speech",
                "topic": "Topic",
                "prompt": "Argue that schools should ban phones.",
                "task": "Respond aloud.",
                "timer_seconds": 60,
            },
        ),
        (
            "impact",
            {
                "title": "Impact Extension",
                "topic": "Topic",
                "prompt": "Climate change harms farmers.",
                "task": "Impact out.",
                "timer_seconds": 60,
            },
        ),
    ],
)
async def test_generate_drill_text_types(drill_type, payload):
    mock = AsyncMock(return_value=_mock_chat_completion(payload))
    with patch.object(drills_service._openai_client.chat.completions, "create", mock):
        prompt = await drills_service.generate_drill(drill_type)
    assert isinstance(prompt, DrillPrompt)
    assert prompt.prompt.strip()
    assert prompt.title


async def test_generate_drill_contention_no_openai():
    # contention drills are deterministic — no OpenAI call needed.
    prompt = await drills_service.generate_drill("contention", timer_seconds=45)
    assert isinstance(prompt, DrillPrompt)
    assert "Side:" in prompt.prompt
    assert "Resolution:" in prompt.prompt
    assert prompt.timer_seconds == 45


async def test_generate_drill_speed_respects_timer():
    target_120 = drills_service.speed_passage_word_target(120)
    target_30 = drills_service.speed_passage_word_target(30)
    assert target_120 > target_30
    # 120 sec * 5 wpm = 600 words (clamped at 600)
    assert target_120 == 600
    # 30 sec * 5 = 150 words
    assert target_30 == 150

    # Generate a speed drill — model returns a very long passage; we expect
    # the service to trim it to the target word count.
    long_passage = " ".join(["word"] * 800) + "."
    payload = {
        "title": "Speed Reading",
        "topic": "Speed",
        "prompt": long_passage,
        "task": "Read aloud.",
        "timer_seconds": 60,
    }
    mock = AsyncMock(return_value=_mock_chat_completion(payload))
    with patch.object(drills_service._openai_client.chat.completions, "create", mock):
        prompt = await drills_service.generate_drill("speed", timer_seconds=60)

    target = drills_service.speed_passage_word_target(60)
    actual = drills_service._word_count(prompt.prompt)
    # Trim leaves us close to the target (within 5 words).
    assert abs(actual - target) <= 5


async def test_generate_drill_unknown_type_raises():
    with pytest.raises(ValueError):
        await drills_service.generate_drill("bogus")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Service: scoring
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("drill_type", ["rebuttal", "impact", "contention", "speed"])
async def test_score_drill_returns_valid_drillscore(drill_type):
    payload = {
        "score": 7,
        "feedback": "Solid response, sharpen the warrant.",
        "strengths": ["clear structure"],
        "improvements": ["add a weighing comparison"],
    }
    mock = AsyncMock(return_value=_mock_chat_completion(payload))
    drill = DrillPrompt(
        title="x", topic="y", prompt="z", task="t", timer_seconds=60
    )
    with patch.object(drills_service._openai_client.chat.completions, "create", mock):
        score = await drills_service.score_drill(drill_type, drill, "my response text")
    assert score.score == 7
    assert "warrant" in score.feedback
    assert score.strengths == ["clear structure"]
    assert score.improvements == ["add a weighing comparison"]


async def test_score_drill_unknown_type_raises():
    with pytest.raises(ValueError):
        await drills_service.score_drill("bogus", {}, "response")  # type: ignore[arg-type]


async def test_score_drill_handles_openai_error():
    mock = AsyncMock(side_effect=RuntimeError("boom"))
    drill = DrillPrompt(title="x", topic="y", prompt="z", task="t", timer_seconds=60)
    with patch.object(drills_service._openai_client.chat.completions, "create", mock):
        score = await drills_service.score_drill("rebuttal", drill, "hello")
    assert score.score == 0
    assert score.improvements


# ---------------------------------------------------------------------------
# Reading accuracy
# ---------------------------------------------------------------------------


def test_reading_accuracy_identical_is_one():
    text = "The quick brown fox jumps over the lazy dog."
    assert drills_service.calculate_reading_accuracy(text, text) == pytest.approx(1.0)


def test_reading_accuracy_totally_different_is_low():
    ref = "the quick brown fox jumps over the lazy dog"
    spoken = "completely unrelated zebra zulu xylophone"
    acc = drills_service.calculate_reading_accuracy(ref, spoken)
    assert acc < 0.2


def test_reading_accuracy_empty_inputs():
    assert drills_service.calculate_reading_accuracy("", "anything") == 0.0
    assert drills_service.calculate_reading_accuracy("anything", "") == 0.0


def test_reading_match_counts_support_completion_metric():
    matched, attempted, passage_words = drills_service.reading_match_counts(
        "one two three four",
        "one two five",
    )
    assert matched == 2
    assert attempted == 3
    assert passage_words == 4


def test_compute_wpm_basic():
    # 10 words in 30 seconds => 20 wpm.
    transcript = "one two three four five six seven eight nine ten"
    assert drills_service.compute_wpm(transcript, 30.0) == 20


def test_compute_speed_wpm_series_uses_word_timestamps():
    series = drills_route._compute_speed_wpm_series(
        [
            {"text": "one", "start": 0, "end": 400},
            {"text": "two", "start": 1000, "end": 1400},
            {"text": "three", "start": 2500, "end": 2900},
        ],
        "one two three",
        4.0,
        interval=2,
    )
    assert [point.wpm for point in series] == [60, 30]


@pytest.mark.asyncio
@respx.mock
async def test_transcribe_audio_uses_current_assemblyai_speech_models():
    respx.post("https://api.assemblyai.com/v2/upload").mock(
        return_value=httpx.Response(200, json={"upload_url": "https://cdn/audio"})
    )
    transcript_route = respx.post("https://api.assemblyai.com/v2/transcript").mock(
        return_value=httpx.Response(200, json={"id": "tid-1"})
    )
    respx.get("https://api.assemblyai.com/v2/transcript/tid-1").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "completed",
                "text": "hello world",
                "audio_duration": 2,
                "words": [
                    {"text": "hello", "start": 0, "end": 500},
                    {"text": "world", "start": 1000, "end": 1500},
                ],
            },
        )
    )

    with patch.object(drills_service, "_sleep", AsyncMock()):
        transcript, duration = await drills_service.transcribe_audio(b"abc", "test-key")

    assert transcript == "hello world"
    assert duration == 2
    assert b'"speech_models":["universal-2"]' in transcript_route.calls.last.request.content


@pytest.mark.asyncio
@respx.mock
async def test_transcribe_audio_can_return_words_for_speed_graph():
    respx.post("https://api.assemblyai.com/v2/upload").mock(
        return_value=httpx.Response(200, json={"upload_url": "https://cdn/audio"})
    )
    respx.post("https://api.assemblyai.com/v2/transcript").mock(
        return_value=httpx.Response(200, json={"id": "tid-words"})
    )
    respx.get("https://api.assemblyai.com/v2/transcript/tid-words").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "completed",
                "text": "hello world",
                "audio_duration": 2,
                "words": [{"text": "hello", "start": 0, "end": 500}],
            },
        )
    )

    with patch.object(drills_service, "_sleep", AsyncMock()):
        transcript, duration, words = await drills_service.transcribe_audio(
            b"abc", "test-key", include_words=True
        )

    assert transcript == "hello world"
    assert duration == 2
    assert words == [{"text": "hello", "start": 0, "end": 500}]


# ---------------------------------------------------------------------------
# Routes: 401 behavior
# ---------------------------------------------------------------------------


client = TestClient(app)


def test_create_drill_requires_auth():
    response = client.post("/api/drills", json={"drill_type": "rebuttal"})
    assert response.status_code == 401


def test_score_drill_requires_auth():
    response = client.post("/api/drills/some-id/score", json={"response": "hi"})
    assert response.status_code == 401


def test_score_speed_requires_auth():
    response = client.post(
        "/api/drills/some-id/score-speed",
        files={"audio": ("a.wav", b"123", "audio/wav")},
    )
    assert response.status_code == 401


def test_score_audio_requires_auth():
    response = client.post(
        "/api/drills/some-id/score-audio",
        files={"audio": ("a.wav", b"123", "audio/wav")},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Routes: happy path with stubbed auth + OpenAI
# ---------------------------------------------------------------------------


def test_create_drill_route_happy_path(authed_user):
    payload = {
        "title": "Rebuttal Speech",
        "topic": "Schools",
        "prompt": "Argue against phone bans.",
        "task": "Respond aloud.",
        "timer_seconds": 60,
    }
    mock = AsyncMock(return_value=_mock_chat_completion(payload))
    with patch.object(drills_service._openai_client.chat.completions, "create", mock):
        response = client.post(
            "/api/drills",
            json={"drill_type": "rebuttal"},
            headers={"authorization": "Bearer fake"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["drill_type"] == "rebuttal"
    assert body["prompt"]["title"] == "Rebuttal Speech"
    assert body["id"]


def test_score_route_uses_stored_drill(authed_user):
    create_payload = {
        "title": "Rebuttal Speech",
        "topic": "Schools",
        "prompt": "Argue against phone bans.",
        "task": "Respond aloud.",
        "timer_seconds": 60,
    }
    score_payload = {
        "score": 8,
        "feedback": "Strong rebuttal.",
        "strengths": ["clear claim"],
        "improvements": ["add weighing"],
    }
    mock = AsyncMock(side_effect=[
        _mock_chat_completion(create_payload),
        _mock_chat_completion(score_payload),
    ])
    with patch.object(drills_service._openai_client.chat.completions, "create", mock):
        created = client.post(
            "/api/drills",
            json={"drill_type": "rebuttal"},
            headers={"authorization": "Bearer fake"},
        ).json()
        scored = client.post(
            f"/api/drills/{created['id']}/score",
            json={"response": "Phones improve learning when used well."},
            headers={"authorization": "Bearer fake"},
        )
    assert scored.status_code == 200, scored.text
    assert scored.json()["score"] == 8
