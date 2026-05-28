"""Tests for the rounds router + transcription pipeline."""

from __future__ import annotations

import io
import sys
import types
import uuid
from typing import Any

import httpx
import pytest
import respx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Auth: override the real deps.auth.get_current_user via FastAPI's
# dependency_overrides. Avoids sys.modules shimming so we don't fight
# import order with other test modules.
# ---------------------------------------------------------------------------


class _FakeUser(BaseModel):
    id: str
    email: str | None = None


# Holds the user the override should return for the current test. Mutated by
# the ``auth_user_a`` fixture; ``None`` means the override raises 401.
fake_auth = types.SimpleNamespace(current_user=None)


from deps.auth import get_current_user as _real_get_current_user  # noqa: E402
from routes import rounds as rounds_route  # noqa: E402
from services import rounds as rounds_service  # noqa: E402
from services import supabase_client  # noqa: E402


USER_A = _FakeUser(id=str(uuid.uuid4()), email="a@example.com")
USER_B = _FakeUser(id=str(uuid.uuid4()), email="b@example.com")


# ---------------------------------------------------------------------------
# In-memory fake Supabase client.
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class _FakeQuery:
    def __init__(self, table: "_FakeTable", op: str, payload: Any = None) -> None:
        self.table = table
        self.op = op
        self.payload = payload
        self.filters: list[tuple[str, Any]] = []
        self.order_field: str | None = None
        self.order_desc: bool = False
        self.limit_n: int | None = None

    def eq(self, field: str, value: Any) -> "_FakeQuery":
        self.filters.append((field, value))
        return self

    def order(self, field: str, desc: bool = False) -> "_FakeQuery":
        self.order_field = field
        self.order_desc = desc
        return self

    def limit(self, n: int) -> "_FakeQuery":
        self.limit_n = n
        return self

    def _matches(self, row: dict) -> bool:
        return all(row.get(f) == v for f, v in self.filters)

    def execute(self) -> _FakeResponse:
        if self.op == "insert":
            row = {
                "id": str(uuid.uuid4()),
                "created_at": "2026-01-01T00:00:00+00:00",
                **self.payload,
            }
            self.table.rows.append(row)
            return _FakeResponse([row])
        if self.op == "select":
            matched = [r for r in self.table.rows if self._matches(r)]
            if self.order_field:
                matched.sort(
                    key=lambda r: r.get(self.order_field) or "",
                    reverse=self.order_desc,
                )
            if self.limit_n is not None:
                matched = matched[: self.limit_n]
            return _FakeResponse(matched)
        if self.op == "update":
            updated: list[dict] = []
            for row in self.table.rows:
                if self._matches(row):
                    row.update(self.payload)
                    updated.append(row)
            return _FakeResponse(updated)
        raise AssertionError(f"unknown op {self.op}")


class _FakeTable:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def insert(self, payload: dict) -> _FakeQuery:
        return _FakeQuery(self, "insert", payload)

    def select(self, *_args: Any, **_kw: Any) -> _FakeQuery:
        return _FakeQuery(self, "select")

    def update(self, payload: dict) -> _FakeQuery:
        return _FakeQuery(self, "update", payload)


class _FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, _FakeTable] = {}

    def table(self, name: str) -> _FakeTable:
        return self.tables.setdefault(name, _FakeTable())


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_supabase(monkeypatch: pytest.MonkeyPatch) -> _FakeSupabase:
    fake = _FakeSupabase()
    monkeypatch.setattr(supabase_client, "get_supabase", lambda: fake)
    monkeypatch.setattr(rounds_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    app = FastAPI()
    app.include_router(rounds_route.router, prefix="/api")

    async def _override() -> _FakeUser:
        user = fake_auth.current_user
        if user is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return user

    app.dependency_overrides[_real_get_current_user] = _override
    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth_user_a(monkeypatch: pytest.MonkeyPatch) -> _FakeUser:
    monkeypatch.setattr(fake_auth, "current_user", USER_A)
    return USER_A


@pytest.fixture(autouse=True)
def _set_aai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "test-key")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_unauthenticated_rejected(client: TestClient) -> None:
    fake_auth.current_user = None  # type: ignore[attr-defined]
    r = client.get("/api/rounds")
    assert r.status_code == 401


def test_create_round_writes_user_id(
    client: TestClient,
    fake_supabase: _FakeSupabase,
    auth_user_a: _FakeUser,
) -> None:
    resp = client.post(
        "/api/rounds",
        json={"format": "parli", "topic": "AI policy", "side": "aff"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] == auth_user_a.id
    assert body["topic"] == "AI policy"

    stored = fake_supabase.tables["rounds"].rows
    assert len(stored) == 1
    assert stored[0]["user_id"] == auth_user_a.id


def test_list_rounds_only_returns_caller_rows(
    client: TestClient,
    fake_supabase: _FakeSupabase,
    auth_user_a: _FakeUser,
) -> None:
    table = fake_supabase.tables.setdefault("rounds", _FakeTable())
    table.rows.extend(
        [
            {
                "id": str(uuid.uuid4()),
                "user_id": USER_A.id,
                "format": "parli",
                "topic": "mine",
                "side": "aff",
                "created_at": "2026-01-02T00:00:00+00:00",
            },
            {
                "id": str(uuid.uuid4()),
                "user_id": USER_B.id,
                "format": "parli",
                "topic": "someone else's",
                "side": "neg",
                "created_at": "2026-01-03T00:00:00+00:00",
            },
        ]
    )

    resp = client.get("/api/rounds")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["user_id"] == USER_A.id


def test_get_round_other_user_returns_404(
    client: TestClient,
    fake_supabase: _FakeSupabase,
    auth_user_a: _FakeUser,
) -> None:
    other_id = str(uuid.uuid4())
    table = fake_supabase.tables.setdefault("rounds", _FakeTable())
    table.rows.append(
        {
            "id": other_id,
            "user_id": USER_B.id,
            "format": "parli",
            "topic": "private",
            "side": "neg",
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    )

    resp = client.get(f"/api/rounds/{other_id}")
    assert resp.status_code == 404


@respx.mock
def test_speeches_happy_path(
    client: TestClient,
    fake_supabase: _FakeSupabase,
    auth_user_a: _FakeUser,
) -> None:
    # Seed a round.
    round_id = str(uuid.uuid4())
    table = fake_supabase.tables.setdefault("rounds", _FakeTable())
    table.rows.append(
        {
            "id": round_id,
            "user_id": USER_A.id,
            "format": "parli",
            "topic": "test",
            "side": "aff",
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    )

    respx.post("https://api.assemblyai.com/v2/upload").mock(
        return_value=httpx.Response(200, json={"upload_url": "https://cdn/foo"})
    )
    respx.post("https://api.assemblyai.com/v2/transcript").mock(
        return_value=httpx.Response(200, json={"id": "tid-1", "status": "queued"})
    )
    respx.get("https://api.assemblyai.com/v2/transcript/tid-1").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "tid-1",
                "status": "completed",
                "text": "hello world this is a test transcription",
                "audio_duration": 60.0,
                "words": [
                    {"text": "hello", "start": 0, "end": 500},
                    {"text": "world", "start": 500, "end": 1000},
                    {"text": "this", "start": 1000, "end": 1500},
                    {"text": "is", "start": 1500, "end": 2000},
                    {"text": "a", "start": 2000, "end": 2500},
                    {"text": "test", "start": 2500, "end": 3000},
                    {"text": "transcription", "start": 3000, "end": 3500},
                ],
            },
        )
    )

    files = {"audio": ("speech.webm", io.BytesIO(b"\x00\x01webmbytes"), "audio/webm")}
    data = {"speech_type": "aff"}
    resp = client.post(f"/api/rounds/{round_id}/speeches", files=files, data=data)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "hello world" in body["transcript"]
    # 7 words over 1 minute → 7 wpm
    assert body["wpm"] == 7
    assert body["duration_seconds"] == 60.0
    assert isinstance(body["wpm_series"], list)

    # Verify the round was updated.
    row = next(r for r in table.rows if r["id"] == round_id)
    assert row["aff_speech"] == body["transcript"]
    assert row["average_wpm"] == 7
    assert row["first_speech_wpm"] == 7
    assert row["wpm_series"]["aff"] == body["wpm_series"]


def test_merge_wpm_series_preserves_both_recorded_speeches() -> None:
    existing = {"aff": [{"t": 0, "wpm": 120}]}
    merged = rounds_route._merge_wpm_series(
        existing,
        "aff_two",
        [{"t": 0, "wpm": 140}],
    )
    assert merged == {
        "aff": [{"t": 0, "wpm": 120}],
        "aff_two": [{"t": 0, "wpm": 140}],
    }


@respx.mock
def test_speeches_aai_error_returns_502(
    client: TestClient,
    fake_supabase: _FakeSupabase,
    auth_user_a: _FakeUser,
) -> None:
    round_id = str(uuid.uuid4())
    table = fake_supabase.tables.setdefault("rounds", _FakeTable())
    table.rows.append(
        {
            "id": round_id,
            "user_id": USER_A.id,
            "format": "parli",
            "topic": "test",
            "side": "aff",
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    )

    respx.post("https://api.assemblyai.com/v2/upload").mock(
        return_value=httpx.Response(200, json={"upload_url": "https://cdn/foo"})
    )
    respx.post("https://api.assemblyai.com/v2/transcript").mock(
        return_value=httpx.Response(200, json={"id": "tid-err", "status": "queued"})
    )
    respx.get("https://api.assemblyai.com/v2/transcript/tid-err").mock(
        return_value=httpx.Response(
            200, json={"id": "tid-err", "status": "error", "error": "bad audio"}
        )
    )

    files = {"audio": ("speech.webm", io.BytesIO(b"abc"), "audio/webm")}
    resp = client.post(
        f"/api/rounds/{round_id}/speeches",
        files=files,
        data={"speech_type": "aff"},
    )
    assert resp.status_code == 502
    assert "bad audio" in resp.json()["detail"]
