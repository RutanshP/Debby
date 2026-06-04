"""Tests for the coach progress dashboard endpoint."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import classroom as classroom_route
from routes import coach_progress as coach_progress_route
from services import classroom as classroom_service
from services import coach_progress as coach_progress_service
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
        self._range: tuple[int, int] | None = None

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

    def range(self, start: int, end: int) -> "_FakeQuery":
        self._range = (start, end)
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
            self.table.rows.append(row)
            return _FakeResponse([row])

        if self.op == "select":
            rows = [row for row in self.table.rows if self._matches(row)]
            if self.order_field:
                rows.sort(
                    key=lambda row: row.get(self.order_field) or "",
                    reverse=self.order_desc,
                )
            if self._range is not None:
                start, end = self._range
                rows = rows[start : end + 1]
            elif self.limit_n is not None:
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
    monkeypatch.setattr(coach_progress_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    app = FastAPI()
    app.include_router(classroom_route.router, prefix="/api")
    app.include_router(coach_progress_route.router, prefix="/api")

    async def _override() -> _FakeUser:
        if CURRENT_USER is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return CURRENT_USER

    app.dependency_overrides[_real_get_current_user] = _override
    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_user() -> None:
    global CURRENT_USER
    CURRENT_USER = COACH


def _setup_class_with_student(client: TestClient) -> str:
    global CURRENT_USER
    CURRENT_USER = COACH
    created = client.post("/api/classes", json={"name": "Progress Test Class"})
    assert created.status_code == 200, created.text
    join_code = created.json()["join_code"]

    CURRENT_USER = STUDENT
    joined = client.post("/api/classes/join", json={"join_code": join_code.lower()})
    assert joined.status_code == 200, joined.text

    CURRENT_USER = COACH
    return created.json()["id"]


def test_competitor_gets_403_on_class_progress(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _setup_class_with_student(client)

    CURRENT_USER = STUDENT
    resp = client.get(f"/api/classes/{class_id}/progress")
    assert resp.status_code == 403


def test_coach_receives_students_with_rounds_and_drills(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _setup_class_with_student(client)

    # Seed some rounds and drills for the student
    round_id = str(uuid.uuid4())
    recipient_id = str(uuid.uuid4())
    fake_supabase.table("rounds").rows.append({
        "id": round_id,
        "user_id": STUDENT.id,
        "topic": "Ban phones",
        "format": "parli",
        "side": "aff",
        "winner_side": "aff",
        "flow": {"ballot": {"winner": "aff"}, "dropped": [], "recommended_drills": []},
        "average_wpm": 160,
        "first_speech_wpm": 155,
        "second_speech_wpm": 165,
        "total_speech_time": 120,
        "speech_metrics": {},
        "filler_count": 2,
        "filler_per_minute": 1.0,
        "major_pause_count": 0,
        "created_at": "2026-01-15T10:00:00+00:00",
    })
    fake_supabase.table("assignment_submissions").rows.append({
        "id": str(uuid.uuid4()),
        "recipient_id": recipient_id,
        "user_id": STUDENT.id,
        "round_id": round_id,
        "created_at": "2026-01-15T10:05:00+00:00",
    })
    fake_supabase.table("drills").rows.append({
        "id": str(uuid.uuid4()),
        "user_id": STUDENT.id,
        "drill_type": "rebuttal",
        "prompt": {"title": "Rebuttal", "prompt": "Defend free trade.", "timer_seconds": 60},
        "score": {"score": 8, "feedback": "Good."},
        "numeric_score": 8,
        "duration_seconds": 58.0,
        "wpm": None,
        "accuracy": None,
        "completion": None,
        "timer_seconds": 60,
        "created_at": "2026-01-15T11:00:00+00:00",
    })

    CURRENT_USER = COACH
    resp = client.get(f"/api/classes/{class_id}/progress")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "students" in body
    assert len(body["students"]) == 1
    student_data = body["students"][0]
    assert student_data["user_id"] == STUDENT.id
    assert len(student_data["rounds"]) == 1
    assert len(student_data["drills"]) == 1
    assert student_data["rounds"][0]["topic"] == "Ban phones"
    assert student_data["rounds"][0]["recipient_id"] == recipient_id
    assert student_data["drills"][0]["drill_type"] == "rebuttal"


def test_coach_sees_empty_lists_when_no_data(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _setup_class_with_student(client)

    CURRENT_USER = COACH
    resp = client.get(f"/api/classes/{class_id}/progress")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["students"][0]["rounds"] == []
    assert body["students"][0]["drills"] == []


def test_non_member_gets_403(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _setup_class_with_student(client)

    CURRENT_USER = OTHER
    resp = client.get(f"/api/classes/{class_id}/progress")
    assert resp.status_code == 403
