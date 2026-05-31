"""Tests for cases routes + service (A6)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from services import cases as cases_service

from deps.auth import User, get_current_user as _real_get_current_user


async def _fake_user() -> User:
    return User(id="00000000-0000-0000-0000-000000000001", email="t@example.com")


@pytest.fixture
def authed():
    app.dependency_overrides[_real_get_current_user] = _fake_user
    try:
        yield
    finally:
        app.dependency_overrides.pop(_real_get_current_user, None)


client = TestClient(app)


def _mock_completion(text: str) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


# --- Service ---------------------------------------------------------------


@pytest.mark.parametrize("side", ["aff", "neg"])
async def test_make_case_returns_markdown(side: str):
    mock = AsyncMock(return_value=_mock_completion("# Parli case\nbody"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        out = await cases_service.make_case("UBI", side)
    assert "Parli case" in out
    assert mock.await_count == 1


async def test_make_case_instructs_complex_parli_tuli():
    mock = AsyncMock(return_value=_mock_completion("# Parli case\nbody"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        await cases_service.make_case(
            "The United States should provide military aid to Nigeria", "aff"
        )

    kwargs = mock.await_args.kwargs
    system_prompt = kwargs["messages"][0]["content"]
    user_prompt = kwargs["messages"][1]["content"]
    assert "**Tagline**" in system_prompt
    assert "classify the round as policy, value, or fact" in system_prompt
    assert "Always use TULI for policy and value rounds" in system_prompt
    assert "For fact rounds, use Claim/Warrant/Impact" in system_prompt
    assert "**Uniqueness:**" in user_prompt
    assert "**Links:**" in user_prompt
    assert "**Internal Links:**" in user_prompt
    assert "**Impacts:**" in user_prompt
    assert "status quo harm" in user_prompt
    assert "good things worth preserving" in user_prompt
    assert "AFF plan passes" in user_prompt
    assert "counterplan" in user_prompt
    assert "logically consistent" in user_prompt
    assert "operational and concrete" in user_prompt
    assert "status quo baseline" in user_prompt
    assert "Each U point must have" in user_prompt
    assert "at least 4 evidence bullets" in user_prompt
    assert "Use the arrow symbol `→`" in user_prompt
    assert "L1 short name" in user_prompt
    assert "- IL1 - label" in user_prompt
    assert "Do not use Claim/Warrant/Impact headings" in user_prompt
    assert "For Parli fact rounds, use Claim/Warrant/Impact" in user_prompt
    assert "around 5 words" in user_prompt
    assert "Make 3 contentions if" in user_prompt
    assert "directly support the overall contention" in user_prompt
    assert "Under each evidence bullet, add logical reasoning" in user_prompt
    assert "one event can create several downstream consequences" in user_prompt
    assert "dense casefile-style impact paragraphs" in user_prompt


@pytest.mark.parametrize("side", ["aff", "neg"])
async def test_make_mspdp_case_returns_markdown(side: str):
    mock = AsyncMock(return_value=_mock_completion("# MSPDP case\nbody"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        out = await cases_service.make_mspdp_case("phones", side)
    assert "MSPDP case" in out


async def test_mspdp_uses_mspdp_prompt_not_parli_tuli_rules():
    mock = AsyncMock(return_value=_mock_completion("# MSPDP case\nbody"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        await cases_service.make_mspdp_case(
            "The United States should substantially increase housing subsidies",
            "aff",
        )

    kwargs = mock.await_args.kwargs
    system_prompt = kwargs["messages"][0]["content"]
    user_prompt = kwargs["messages"][1]["content"]
    assert "Always use TULI" not in system_prompt
    assert "TULI" not in user_prompt
    assert "ARESI for policy and value rounds" in system_prompt
    assert "For MSPDP policy and value rounds" in user_prompt
    assert "For MSPDP fact rounds, use Claim/Warrant/Impact" in user_prompt
    assert "AFF Contention Template" in user_prompt
    assert "Below is an MSPDP case template" in user_prompt
    assert "Below is a parliamentary case template" not in user_prompt


# --- Routes ---------------------------------------------------------------


def test_create_case_requires_auth():
    r = client.post("/api/cases", json={"format": "parli", "topic": "x", "side": "aff"})
    assert r.status_code == 401


def test_random_case_requires_auth():
    r = client.post("/api/cases/random", json={"format": "parli"})
    assert r.status_code == 401


def test_create_case_happy_parli(authed):
    mock = AsyncMock(return_value=_mock_completion("# CASE"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        r = client.post(
            "/api/cases", json={"format": "parli", "topic": "UBI", "side": "aff"}
        )
    assert r.status_code == 200
    assert r.json() == {"case": "# CASE"}


def test_create_case_rejects_topics_over_100_words(authed):
    topic = " ".join(f"word{i}" for i in range(101))
    mock = AsyncMock(return_value=_mock_completion("# CASE"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        r = client.post(
            "/api/cases", json={"format": "parli", "topic": topic, "side": "aff"}
        )
    assert r.status_code == 422
    assert mock.await_count == 0


def test_create_case_happy_mspdp(authed):
    mock = AsyncMock(return_value=_mock_completion("# CASE"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        r = client.post(
            "/api/cases", json={"format": "mspdp", "topic": "phones", "side": "neg"}
        )
    assert r.status_code == 200
    assert r.json()["case"]


def test_create_case_invalid_format_422(authed):
    r = client.post(
        "/api/cases", json={"format": "lincoln-douglas", "topic": "x", "side": "aff"}
    )
    assert r.status_code == 422


def test_random_case_returns_topic_and_side(authed):
    mock = AsyncMock(return_value=_mock_completion("# CASE"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        r = client.post("/api/cases/random", json={"format": "mspdp"})
    assert r.status_code == 200
    body = r.json()
    assert body["case"]
    assert body["topic"]
    assert body["side"] in ("aff", "neg")
    assert body["format"] == "mspdp"


def test_create_case_openai_error_returns_502(authed):
    mock = AsyncMock(side_effect=RuntimeError("boom"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        r = client.post(
            "/api/cases", json={"format": "parli", "topic": "x", "side": "aff"}
        )
    assert r.status_code == 502
