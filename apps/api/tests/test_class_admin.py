"""Tests for class-admin routes (Unit 8)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import class_admin as class_admin_route
from routes import classroom as classroom_route
from services import class_admin as class_admin_service
from services import classroom as classroom_service
from services import rounds as rounds_service


# ---------------------------------------------------------------------------
# Fake Supabase infrastructure (mirrors test_classroom.py)
# ---------------------------------------------------------------------------


class _FakeUser(BaseModel):
    id: str
    email: str | None = None


COACH = _FakeUser(id=str(uuid.uuid4()), email="coach@example.com")
COACH2 = _FakeUser(id=str(uuid.uuid4()), email="coach2@example.com")
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

        if self.op == "delete":
            before = len(self.table.rows)
            self.table.rows = [row for row in self.table.rows if not self._matches(row)]
            _ = before  # just for reference
            return _FakeResponse([])

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

    def delete(self) -> _FakeQuery:
        return _FakeQuery(self, "delete")


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
    monkeypatch.setattr(class_admin_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    application = FastAPI()
    application.include_router(classroom_route.router, prefix="/api")
    application.include_router(class_admin_route.router, prefix="/api")

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


def _create_class_and_join_student(client: TestClient) -> str:
    global CURRENT_USER
    CURRENT_USER = COACH
    resp = client.post("/api/classes", json={"name": "Varsity Parli"})
    assert resp.status_code == 200, resp.text
    join_code = resp.json()["join_code"]
    CURRENT_USER = STUDENT
    joined = client.post("/api/classes/join", json={"join_code": join_code.lower()})
    assert joined.status_code == 200, joined.text
    CURRENT_USER = COACH
    return resp.json()["id"]


def _create_drill_assignment(client: TestClient, class_id: str) -> str:
    """Returns assignment id (not recipient id)."""
    resp = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Rebuttal reps",
            "type": "drill",
            "payload": {"drill_type": "rebuttal", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["assignment"]["id"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_competitor_cannot_rename_class(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    CURRENT_USER = STUDENT
    resp = client.patch(f"/api/classes/{class_id}", json={"name": "Hacked name"})
    assert resp.status_code == 403


def test_competitor_cannot_regenerate_code(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    CURRENT_USER = STUDENT
    resp = client.post(f"/api/classes/{class_id}/regenerate-code")
    assert resp.status_code == 403


def test_competitor_cannot_delete_assignment(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    assignment_id = _create_drill_assignment(client, class_id)
    CURRENT_USER = STUDENT
    resp = client.delete(f"/api/assignments/{assignment_id}")
    assert resp.status_code == 403


def test_coach_can_rename_class(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    class_id = _create_class_and_join_student(client)
    resp = client.patch(f"/api/classes/{class_id}", json={"name": "Junior Parli"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Junior Parli"
    # Verify stored name changed
    class_rows = [r for r in fake_supabase.table("classes").rows if r["id"] == class_id]
    assert class_rows[0]["name"] == "Junior Parli"


def test_coach_can_regenerate_code(client: TestClient) -> None:
    class_id = _create_class_and_join_student(client)
    # Get original code
    detail_resp = client.get(f"/api/classes/{class_id}")
    original_code = detail_resp.json()["class_room"]["join_code"]

    resp = client.post(f"/api/classes/{class_id}/regenerate-code")
    assert resp.status_code == 200, resp.text
    new_code = resp.json()["join_code"]
    assert new_code != original_code
    assert len(new_code) == 6


def test_coach_can_remove_competitor(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    # Remove STUDENT
    resp = client.delete(f"/api/classes/{class_id}/members/{STUDENT.id}")
    assert resp.status_code == 204, resp.text
    remaining_members = [
        m for m in fake_supabase.table("class_members").rows
        if m["class_id"] == class_id
    ]
    assert all(m["user_id"] != STUDENT.id for m in remaining_members)


def test_coach_can_promote_competitor_to_coach(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    class_id = _create_class_and_join_student(client)
    resp = client.patch(
        f"/api/classes/{class_id}/members/{STUDENT.id}",
        json={"role": "coach"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "coach"
    promoted = [
        m
        for m in fake_supabase.table("class_members").rows
        if m["class_id"] == class_id and m["user_id"] == STUDENT.id
    ]
    assert promoted[0]["role"] == "coach"


def test_coach_cannot_remove_last_coach(client: TestClient) -> None:
    class_id = _create_class_and_join_student(client)
    # Attempt to remove the only coach (COACH) via remove_member (using remove on self)
    # remove_member blocks self-removal; use direct service call style — test via API
    resp = client.delete(f"/api/classes/{class_id}/members/{COACH.id}")
    # Coach removing self is blocked with 403 ("use leave_class")
    assert resp.status_code == 403


def test_last_coach_cannot_leave(client: TestClient) -> None:
    class_id = _create_class_and_join_student(client)
    resp = client.post(f"/api/classes/{class_id}/leave")
    assert resp.status_code == 403


def test_student_can_leave_class(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    CURRENT_USER = STUDENT
    resp = client.post(f"/api/classes/{class_id}/leave")
    assert resp.status_code == 204, resp.text
    remaining = [
        m for m in fake_supabase.table("class_members").rows
        if m["class_id"] == class_id and m["user_id"] == STUDENT.id
    ]
    assert remaining == []


def test_coach_can_delete_assignment(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    class_id = _create_class_and_join_student(client)
    assignment_id = _create_drill_assignment(client, class_id)
    resp = client.delete(f"/api/assignments/{assignment_id}")
    assert resp.status_code == 204, resp.text
    remaining = [r for r in fake_supabase.table("assignments").rows if r["id"] == assignment_id]
    assert remaining == []


def test_coach_can_update_assignment_title(client: TestClient) -> None:
    class_id = _create_class_and_join_student(client)
    assignment_id = _create_drill_assignment(client, class_id)
    resp = client.patch(f"/api/assignments/{assignment_id}", json={"title": "Updated title"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "Updated title"


def test_outsider_cannot_remove_member(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    CURRENT_USER = OTHER
    resp = client.delete(f"/api/classes/{class_id}/members/{STUDENT.id}")
    assert resp.status_code == 403


def test_coach_can_archive_class(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    class_id = _create_class_and_join_student(client)
    resp = client.patch(f"/api/classes/{class_id}", json={"archived": True})
    assert resp.status_code == 200, resp.text
    class_rows = [r for r in fake_supabase.table("classes").rows if r["id"] == class_id]
    assert class_rows[0]["archived"] is True
