from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import classroom as classroom_route
from routes import stream as stream_route
from services import classroom as classroom_service
from services import stream as stream_service


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

        if self.op == "delete":
            remaining = [row for row in self.table.rows if not self._matches(row)]
            deleted = [row for row in self.table.rows if self._matches(row)]
            self.table.rows[:] = remaining
            return _FakeResponse(deleted)

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
    monkeypatch.setattr(stream_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    app = FastAPI()
    app.include_router(classroom_route.router, prefix="/api")
    app.include_router(stream_route.router, prefix="/api")

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


def _create_class_and_join_student(client: TestClient) -> str:
    global CURRENT_USER
    CURRENT_USER = COACH
    created = client.post("/api/classes", json={"name": "Debate 101"})
    assert created.status_code == 200, created.text
    join_code = created.json()["join_code"]
    CURRENT_USER = STUDENT
    joined = client.post("/api/classes/join", json={"join_code": join_code.lower()})
    assert joined.status_code == 200, joined.text
    CURRENT_USER = COACH
    return created.json()["id"]


def test_coach_can_post_announcement_and_member_can_list(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)

    CURRENT_USER = COACH
    resp = client.post(
        f"/api/classes/{class_id}/posts",
        json={"type": "announcement", "title": "Welcome!", "body": "Hello team."},
    )
    assert resp.status_code == 200, resp.text
    post = resp.json()
    assert post["type"] == "announcement"
    assert post["title"] == "Welcome!"

    # Student (member) can list posts.
    CURRENT_USER = STUDENT
    list_resp = client.get(f"/api/classes/{class_id}/posts")
    assert list_resp.status_code == 200, list_resp.text
    posts = list_resp.json()
    assert len(posts) == 1
    assert posts[0]["id"] == post["id"]


def test_competitor_cannot_post(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)

    CURRENT_USER = STUDENT
    resp = client.post(
        f"/api/classes/{class_id}/posts",
        json={"type": "announcement", "body": "Not allowed."},
    )
    assert resp.status_code == 403


def test_non_member_cannot_list_posts(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)

    CURRENT_USER = COACH
    client.post(
        f"/api/classes/{class_id}/posts",
        json={"type": "material", "body": "Watch this.", "link_url": "https://youtu.be/abc"},
    )

    CURRENT_USER = OTHER
    resp = client.get(f"/api/classes/{class_id}/posts")
    assert resp.status_code == 403


def test_coach_can_delete_post(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)

    CURRENT_USER = COACH
    post_resp = client.post(
        f"/api/classes/{class_id}/posts",
        json={"type": "announcement", "body": "To be deleted."},
    )
    assert post_resp.status_code == 200, post_resp.text
    post_id = post_resp.json()["id"]

    del_resp = client.delete(f"/api/classes/{class_id}/posts/{post_id}")
    assert del_resp.status_code == 204

    list_resp = client.get(f"/api/classes/{class_id}/posts")
    assert list_resp.status_code == 200
    assert list_resp.json() == []


def test_material_post_with_link_url(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)

    CURRENT_USER = COACH
    resp = client.post(
        f"/api/classes/{class_id}/posts",
        json={
            "type": "material",
            "title": "Watch this",
            "link_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["type"] == "material"
    assert data["link_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
