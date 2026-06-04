"""Tests for coach feedback and manual grade routes."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import classroom as classroom_route
from routes import feedback as feedback_route
from services import classroom as classroom_service
from services import feedback as feedback_service
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
    monkeypatch.setattr(feedback_service, "get_supabase", lambda: fake)
    monkeypatch.setattr(rounds_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    test_app = FastAPI()
    test_app.include_router(classroom_route.router, prefix="/api")
    test_app.include_router(feedback_route.router, prefix="/api")

    async def _override() -> _FakeUser:
        if CURRENT_USER is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return CURRENT_USER

    test_app.dependency_overrides[_real_get_current_user] = _override
    return test_app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_user() -> None:
    global CURRENT_USER
    CURRENT_USER = COACH


def _setup_class_and_recipient(client: TestClient) -> str:
    """Create class, join student, create drill assignment; return recipient_id."""
    global CURRENT_USER
    CURRENT_USER = COACH
    created = client.post("/api/classes", json={"name": "Test Class"})
    assert created.status_code == 200, created.text
    join_code = created.json()["join_code"]

    CURRENT_USER = STUDENT
    joined = client.post("/api/classes/join", json={"join_code": join_code.lower()})
    assert joined.status_code == 200, joined.text

    CURRENT_USER = COACH
    assignment_resp = client.post(
        f"/api/classes/{created.json()['id']}/assignments",
        json={
            "title": "Test drill",
            "type": "drill",
            "payload": {"drill_type": "rebuttal", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    assert assignment_resp.status_code == 200, assignment_resp.text
    return assignment_resp.json()["recipients"][0]["id"]


def test_competitor_cannot_put_feedback(client: TestClient) -> None:
    global CURRENT_USER
    recipient_id = _setup_class_and_recipient(client)

    CURRENT_USER = STUDENT
    resp = client.put(
        f"/api/recipients/{recipient_id}/feedback",
        json={"grade": 9.0, "feedback": "Good job.", "returned": True},
    )
    assert resp.status_code == 403


def test_coach_can_upsert_feedback(client: TestClient) -> None:
    global CURRENT_USER
    recipient_id = _setup_class_and_recipient(client)

    CURRENT_USER = COACH
    resp = client.put(
        f"/api/recipients/{recipient_id}/feedback",
        json={"grade": 8.5, "feedback": "Solid rebuttal.", "returned": False},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["grade"] == 8.5
    assert body["feedback"] == "Solid rebuttal."
    assert body["returned"] is False
    assert body["recipient_id"] == recipient_id


def test_coach_can_update_and_return_feedback(client: TestClient) -> None:
    global CURRENT_USER
    recipient_id = _setup_class_and_recipient(client)

    CURRENT_USER = COACH
    # First upsert.
    client.put(
        f"/api/recipients/{recipient_id}/feedback",
        json={"grade": 7.0, "feedback": "Needs work.", "returned": False},
    )
    # Second upsert (update).
    resp = client.put(
        f"/api/recipients/{recipient_id}/feedback",
        json={"grade": 8.0, "feedback": "Much better.", "returned": True},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["grade"] == 8.0
    assert body["feedback"] == "Much better."
    assert body["returned"] is True


def test_owning_student_can_read_feedback(client: TestClient) -> None:
    global CURRENT_USER
    recipient_id = _setup_class_and_recipient(client)

    CURRENT_USER = COACH
    client.put(
        f"/api/recipients/{recipient_id}/feedback",
        json={"grade": 9.0, "feedback": "Excellent.", "returned": True},
    )

    CURRENT_USER = STUDENT
    resp = client.get(f"/api/recipients/{recipient_id}/feedback")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["grade"] == 9.0
    assert body["feedback"] == "Excellent."


def test_other_student_cannot_read_feedback(client: TestClient) -> None:
    global CURRENT_USER
    recipient_id = _setup_class_and_recipient(client)

    CURRENT_USER = COACH
    client.put(
        f"/api/recipients/{recipient_id}/feedback",
        json={"grade": 9.0, "feedback": "Excellent.", "returned": True},
    )

    CURRENT_USER = OTHER
    resp = client.get(f"/api/recipients/{recipient_id}/feedback")
    assert resp.status_code in (403, 404)


def test_owning_student_cannot_read_unreturned_feedback(client: TestClient) -> None:
    global CURRENT_USER
    recipient_id = _setup_class_and_recipient(client)

    CURRENT_USER = COACH
    client.put(
        f"/api/recipients/{recipient_id}/feedback",
        json={"grade": 7.0, "feedback": "Needs work.", "returned": False},
    )

    CURRENT_USER = STUDENT
    resp = client.get(f"/api/recipients/{recipient_id}/feedback")
    assert resp.status_code == 200
    assert resp.json() is None
