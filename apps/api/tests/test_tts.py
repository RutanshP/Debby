"""Tests for the TTS service and /api/ai/tts route.

All Deepgram HTTP calls are mocked with respx — no live network calls are made.
"""

from __future__ import annotations

import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response as MockResponse

import main
from routes import ai as ai_route
from services import tts as tts_service
from services.tts import TTSError, _chunk


# ---------------------------------------------------------------------------
# Unit tests for _chunk()
# ---------------------------------------------------------------------------


def test_chunk_short_text_returns_single_item():
    text = "Hello world."
    assert _chunk(text) == [text]


def test_chunk_exactly_max_returns_single_item():
    text = "x" * tts_service.MAX_CHARS
    assert _chunk(text) == [text]


def test_chunk_splits_on_sentence_boundary():
    sentence_a = "First sentence. "
    sentence_b = "Second sentence."
    # Make sentence_b push us over the limit when combined.
    long_a = "A" * (tts_service.MAX_CHARS - 10) + "."
    chunks = _chunk(long_a + " " + sentence_b)
    assert len(chunks) == 2
    assert chunks[0].endswith(".")
    assert chunks[1] == sentence_b


def test_chunk_falls_back_to_word_boundary_for_huge_sentence():
    # One giant sentence with no sentence-boundary punctuation.
    word = "word"
    # Build a string of ~3000 chars with spaces between words.
    text = (" " + word) * 500  # ~2500 chars
    chunks = _chunk(text.strip())
    for chunk in chunks:
        assert len(chunk) <= tts_service.MAX_CHARS
    assert all(chunk for chunk in chunks)  # no empty chunks


def test_chunk_single_word_longer_than_max_chars():
    # A single token that is itself > MAX_CHARS (e.g. base64 blob) must be
    # hard-split so every emitted chunk respects the limit.
    giant_word = "x" * (tts_service.MAX_CHARS + 500)
    chunks = _chunk(giant_word)
    assert all(len(c) <= tts_service.MAX_CHARS for c in chunks)
    assert all(c for c in chunks)  # no empty chunks
    # Reconstructing the word from chunks should give back the original.
    assert "".join(chunks) == giant_word


def test_chunk_no_empty_chunks():
    text = "Hello! " * 300  # ~2100 chars
    chunks = _chunk(text.strip())
    assert all(c.strip() for c in chunks)


# ---------------------------------------------------------------------------
# Route fixtures
# ---------------------------------------------------------------------------


def _override_user():
    return ai_route.User(id="user-tts", email="tts@example.com")


@pytest.fixture
def client_authed():
    main.app.dependency_overrides[ai_route.get_current_user] = _override_user
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.pop(ai_route.get_current_user, None)


@pytest.fixture
def client_unauthed():
    return TestClient(main.app)


# ---------------------------------------------------------------------------
# Route: auth guard
# ---------------------------------------------------------------------------


def test_tts_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post("/api/ai/tts", json={"text": "Hello world"})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Route: short text → exactly one Deepgram call
# ---------------------------------------------------------------------------


@respx.mock
def test_tts_route_short_text_single_call(
    client_authed: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("DEEPGRAM_KEY", "test-key-123")
    fake_audio = b"\xff\xfb\x90\x00" * 16  # fake MP3 bytes

    route = respx.post(tts_service.DEEPGRAM_SPEAK_URL).mock(
        return_value=MockResponse(200, content=fake_audio)
    )

    r = client_authed.post("/api/ai/tts", json={"text": "Hello Debby."})

    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == fake_audio

    # Exactly one Deepgram call for short text.
    assert route.call_count == 1

    # Verify the outgoing request carried the auth header.
    deepgram_request = route.calls[0].request
    assert deepgram_request.headers["authorization"] == "Token test-key-123"

    # Verify the model query param.
    assert "model=" in str(deepgram_request.url)
    assert tts_service.DEFAULT_VOICE in str(deepgram_request.url)


# ---------------------------------------------------------------------------
# Route: long text → multiple Deepgram calls, bytes concatenated in order
# ---------------------------------------------------------------------------


@respx.mock
def test_tts_route_long_text_multiple_calls(
    client_authed: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("DEEPGRAM_KEY", "test-key-456")

    segment_1 = b"\xff\xfb\x90\x00" * 4
    segment_2 = b"\xff\xfb\x94\x00" * 4

    responses = [
        MockResponse(200, content=segment_1),
        MockResponse(200, content=segment_2),
    ]
    route = respx.post(tts_service.DEEPGRAM_SPEAK_URL).mock(side_effect=responses)

    # Build text that exceeds MAX_CHARS by using two long sentences.
    sentence = "This is a fairly long sentence that contributes to the character count. "
    long_text = sentence * 30  # well over 2000 chars

    r = client_authed.post("/api/ai/tts", json={"text": long_text})

    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"

    # More than one Deepgram call was made.
    assert route.call_count >= 2

    # Returned body is the ordered concatenation of the segment bytes.
    assert r.content == segment_1 + segment_2


# ---------------------------------------------------------------------------
# Route: Deepgram returns an error → 502
# ---------------------------------------------------------------------------


@respx.mock
def test_tts_route_deepgram_error_returns_502(
    client_authed: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("DEEPGRAM_KEY", "test-key-789")

    respx.post(tts_service.DEEPGRAM_SPEAK_URL).mock(
        return_value=MockResponse(413, text="Request Entity Too Large")
    )

    r = client_authed.post("/api/ai/tts", json={"text": "Hello."})

    assert r.status_code == 502
    assert "TTS failed" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Route: DEEPGRAM_KEY missing → 502
# ---------------------------------------------------------------------------


def test_tts_route_missing_api_key_returns_502(
    client_authed: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("DEEPGRAM_KEY", raising=False)

    r = client_authed.post("/api/ai/tts", json={"text": "Hello."})

    assert r.status_code == 502
    assert "TTS failed" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Service unit: synthesize() raises TTSError on bad status
# ---------------------------------------------------------------------------


@respx.mock
async def test_synthesize_raises_on_error_status(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEEPGRAM_KEY", "key")

    respx.post(tts_service.DEEPGRAM_SPEAK_URL).mock(
        return_value=MockResponse(500, text="Internal Server Error")
    )

    with pytest.raises(TTSError, match="500"):
        await tts_service.synthesize("Hello.")


# ---------------------------------------------------------------------------
# Service unit: synthesize() raises TTSError when key is absent
# ---------------------------------------------------------------------------


async def test_synthesize_raises_when_key_missing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DEEPGRAM_KEY", raising=False)

    with pytest.raises(TTSError, match="DEEPGRAM_KEY"):
        await tts_service.synthesize("Hello.")
