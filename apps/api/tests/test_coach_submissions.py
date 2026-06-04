"""Tests for the coach submission viewer endpoint.

Mirrors test_classroom.py fixture style.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import classroom as classroom_route
from routes import coach_submissions as coach_submissions_route
from services import classroom as classroom_service
from services import coach_view as coach_view_service
from services import rounds as rounds_service


class _FakeUser(BaseModel):
    id: str
    email: str | None = None


COACH = _FakeUser(id=str(uuid.uuid4()), email="coach@example.com")
STUDENT = _FakeUser(id=str(uuid.uuid4()), email="student@example.com")
OTHER = _FakeUser(id=str(uuid.uuid4()), email="other@example.com")
CURRENT_USER: _FakeUser | None = COACH


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
        self.order_desc = False
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
        return all(row.get(field) == value for field, value in self.filters)

    def execute(self) -> _FakeResponse:
        if self.op == "insert":
            row = {
                "id": str(uuid.uuid4()),
                "created_at": "2026-01-01T00:00:00+00:00",
                **self.payload,
            }
            if self.table.name == "classes":
                for existing in self.table.rows:
                    if existing.get("join_code") == row.get("join_code"):
                        raise RuntimeError("duplicate join_code")
            if self.table.name == "class_members":
                for existing in self.table.rows:
                    if (
                        existing.get("class_id") == row.get("class_id")
                        and existing.get("user_id") == row.get("user_id")
                    ):
                        raise RuntimeError("duplicate member")
            self.table.rows.append(row)
            return _FakeResponse([row])

        if self.op == "select":
            rows = [row for row in self.table.rows if self._matches(row)]
            if self.order_field:
                rows.sort(
                    key=lambda row: row.get(self.order_field) or "",
                    reverse=self.order_desc,
                )
            if self.limit_n is not None:
                rows = rows[: self.limit_n]
            return _FakeResponse(rows)

        if self.op == "update":
            updated: list[dict] = []
            for row in self.table.rows:
                if self._matches(row):
                    row.update(self.payload)
                    updated.append(row)
            return _FakeResponse(updated)

        raise AssertionError(f"unknown op {self.op}")


class _FakeTable:
    def __init__(self, name: str) -> None:
        self.name = name
        self.rows: list[dict] = []

    def insert(self, payload: dict) -> _FakeQuery:
        return _FakeQuery(self, "insert", payload)

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return _FakeQuery(self, "select")

    def update(self, payload: dict) -> _FakeQuery:
        return _FakeQuery(self, "update", payload)


class _FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, _FakeTable] = {}

    def table(self, name: str) -> _FakeTable:
        if name not in self.tables:
            self.tables[name] = _FakeTable(name)
        return self.tables[name]


@pytest.fixture
def fake_supabase(monkeypatch: pytest.MonkeyPatch) -> _FakeSupabase:
    fake = _FakeSupabase()
    monkeypatch.setattr(classroom_service, "get_supabase", lambda: fake)
    monkeypatch.setattr(rounds_service, "get_supabase", lambda: fake)
    monkeypatch.setattr(coach_view_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    application = FastAPI()
    application.include_router(classroom_route.router, prefix="/api")
    application.include_router(coach_submissions_route.router, prefix="/api")

    async def _override() -> _FakeUser:
        if CURRENT_USER is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return CURRENT_USER

    application.dependency_overrides[_real_get_current_user] = _override
    return application


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_user() -> None:
    global CURRENT_USER
    CURRENT_USER = COACH


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _setup_class_with_drill_submission(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> tuple[str, str, str]:
    """Creates class, joins student, assigns drill, student completes it.

    Returns (class_id, recipient_id, drill_id).
    """
    global CURRENT_USER
    CURRENT_USER = COACH
    created = client.post("/api/classes", json={"name": "Test Class"})
    assert created.status_code == 200, created.text
    class_id = created.json()["id"]
    join_code = created.json()["join_code"]

    CURRENT_USER = STUDENT
    joined = client.post("/api/classes/join", json={"join_code": join_code})
    assert joined.status_code == 200, joined.text

    CURRENT_USER = COACH
    assignment_resp = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Rebuttal reps",
            "type": "drill",
            "payload": {"drill_type": "rebuttal", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    assert assignment_resp.status_code == 200, assignment_resp.text
    recipient_id = assignment_resp.json()["recipients"][0]["id"]

    drill_id = str(uuid.uuid4())
    fake_supabase.table("drills").rows.append(
        {
            "id": drill_id,
            "user_id": STUDENT.id,
            "drill_type": "rebuttal",
            "prompt": {"title": "Rebuttal", "topic": "Topic", "prompt": "Arg", "task": "Respond", "timer_seconds": 60},
            "response": "My rebuttal response",
            "score": {"score": 8, "feedback": "Solid clash.", "strengths": ["Clear"], "improvements": ["More depth"]},
            "numeric_score": 8,
            "timer_seconds": 60,
        }
    )

    CURRENT_USER = STUDENT
    complete = client.post(
        f"/api/assignments/{recipient_id}/complete",
        json={"drill_id": drill_id},
    )
    assert complete.status_code == 200, complete.text

    CURRENT_USER = COACH
    return class_id, recipient_id, drill_id


def _setup_class_with_round_submission(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> tuple[str, str, str]:
    """Creates class, joins student, assigns practice round, student completes it.

    Returns (class_id, recipient_id, round_id).
    """
    global CURRENT_USER
    CURRENT_USER = COACH
    created = client.post("/api/classes", json={"name": "Round Class"})
    assert created.status_code == 200, created.text
    class_id = created.json()["id"]
    join_code = created.json()["join_code"]

    CURRENT_USER = STUDENT
    joined = client.post("/api/classes/join", json={"join_code": join_code})
    assert joined.status_code == 200, joined.text

    CURRENT_USER = COACH
    assignment_resp = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Practice round",
            "type": "practice_round",
            "payload": {
                "format": "parli",
                "topic": "Schools should ban phones.",
                "side": "aff",
                "speech_duration_seconds": 120,
            },
            "assign_all": True,
        },
    )
    assert assignment_resp.status_code == 200, assignment_resp.text
    recipient_id = assignment_resp.json()["recipients"][0]["id"]

    CURRENT_USER = STUDENT
    started = client.post(f"/api/assignments/{recipient_id}/start")
    assert started.status_code == 200, started.text
    round_id = started.json()["round_id"]

    # Enrich round with some data so the coach can see content.
    for row in fake_supabase.table("rounds").rows:
        if row["id"] == round_id:
            row.update(
                {
                    "rfd": "Affirmative wins on the education flow.",
                    "winner_side": "aff",
                    "aff_speech": "Schools should ban phones because...",
                    "average_wpm": 145,
                    "first_speech_wpm": 145,
                }
            )

    completed = client.post(
        f"/api/assignments/{recipient_id}/complete",
        json={"round_id": round_id},
    )
    assert completed.status_code == 200, completed.text

    CURRENT_USER = COACH
    return class_id, recipient_id, round_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_non_coach_gets_403(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    """A non-coach (competitor) calling the endpoint receives 403."""
    global CURRENT_USER
    class_id, recipient_id, _ = _setup_class_with_drill_submission(client, fake_supabase)

    CURRENT_USER = STUDENT
    resp = client.get(f"/api/classes/{class_id}/recipients/{recipient_id}/submission")
    assert resp.status_code == 403


def test_outsider_gets_403(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    """A user who is not a member of the class receives 403."""
    global CURRENT_USER
    class_id, recipient_id, _ = _setup_class_with_drill_submission(client, fake_supabase)

    CURRENT_USER = OTHER
    resp = client.get(f"/api/classes/{class_id}/recipients/{recipient_id}/submission")
    assert resp.status_code == 403


def test_coach_can_view_drill_submission(
    client: TestClient, fake_supabase: _FakeSupabase
) -> None:
    """A coach receives the full drill payload for a completed submission."""
    global CURRENT_USER
    class_id, recipient_id, drill_id = _setup_class_with_drill_submission(
        client, fake_supabase
    )

    CURRENT_USER = COACH
    resp = client.get(f"/api/classes/{class_id}/recipients/{recipient_id}/submission")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["type"] == "drill"
    assert body["drill"] is not None
    assert body["drill"]["id"] == drill_id
    assert body["drill"]["drill_type"] == "rebuttal"
    assert body["drill"]["score"]["score"] == 8
    assert body["round"] is None


def test_coach_can_view_round_submission(
    client: TestClient, fake_supabase: _FakeSupabase
) -> None:
    """A coach receives the full round payload for a completed submission."""
    global CURRENT_USER
    class_id, recipient_id, round_id = _setup_class_with_round_submission(
        client, fake_supabase
    )

    CURRENT_USER = COACH
    resp = client.get(f"/api/classes/{class_id}/recipients/{recipient_id}/submission")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["type"] == "round"
    assert body["round"] is not None
    assert body["round"]["id"] == round_id
    assert body["round"]["rfd"] == "Affirmative wins on the education flow."
    assert body["drill"] is None


def test_recipient_from_another_class_is_rejected(
    client: TestClient, fake_supabase: _FakeSupabase
) -> None:
    """Coach of class A cannot view a recipient that belongs to class B."""
    global CURRENT_USER

    # Set up class A (COACH is coach).
    class_id_a, _, _ = _setup_class_with_drill_submission(client, fake_supabase)

    # Set up class B with a different coach (OTHER acts as coach of B).
    CURRENT_USER = OTHER
    created_b = client.post("/api/classes", json={"name": "Class B"})
    assert created_b.status_code == 200, created_b.text
    class_id_b = created_b.json()["id"]
    join_code_b = created_b.json()["join_code"]

    CURRENT_USER = STUDENT
    client.post("/api/classes/join", json={"join_code": join_code_b})

    CURRENT_USER = OTHER
    assignment_b = client.post(
        f"/api/classes/{class_id_b}/assignments",
        json={
            "title": "B drill",
            "type": "drill",
            "payload": {"drill_type": "impact", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    assert assignment_b.status_code == 200, assignment_b.text
    recipient_id_b = assignment_b.json()["recipients"][0]["id"]

    # COACH (coach of class A) tries to view recipient from class B.
    CURRENT_USER = COACH
    resp = client.get(
        f"/api/classes/{class_id_a}/recipients/{recipient_id_b}/submission"
    )
    # Should be 404 because recipient_id_b doesn't belong to class_id_a.
    assert resp.status_code in {403, 404}


def test_submission_without_completion_returns_no_data(
    client: TestClient, fake_supabase: _FakeSupabase
) -> None:
    """If the student hasn't submitted yet, type is returned with null round/drill."""
    global CURRENT_USER
    CURRENT_USER = COACH
    created = client.post("/api/classes", json={"name": "Empty Class"})
    class_id = created.json()["id"]
    join_code = created.json()["join_code"]

    CURRENT_USER = STUDENT
    client.post("/api/classes/join", json={"join_code": join_code})

    CURRENT_USER = COACH
    assignment_resp = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Pending",
            "type": "drill",
            "payload": {"drill_type": "rebuttal", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    recipient_id = assignment_resp.json()["recipients"][0]["id"]

    CURRENT_USER = COACH
    resp = client.get(f"/api/classes/{class_id}/recipients/{recipient_id}/submission")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["round"] is None
    assert body["drill"] is None
