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
    assert "**Uniqueness:**" in user_prompt
    assert "**Links:**" in user_prompt
    assert "**Impacts:**" in user_prompt


@pytest.mark.parametrize("side", ["aff", "neg"])
async def test_make_mspdp_case_returns_markdown(side: str):
    mock = AsyncMock(return_value=_mock_completion("# MSPDP case\nbody"))
    with patch.object(cases_service.client.chat.completions, "create", mock):
        out = await cases_service.make_mspdp_case("phones", side)
    assert "MSPDP case" in out


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
