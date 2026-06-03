"""Tests for the comments feature."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import comments as comments_route
from services import classroom as classroom_service
from services import comments as comments_service


class _FakeUser(BaseModel):
    id: str
    email: str | None = None


COACH = _FakeUser(id=str(uuid.uuid4()), email="coach@example.com")
STUDENT_A = _FakeUser(id=str(uuid.uuid4()), email="student_a@example.com")
STUDENT_B = _FakeUser(id=str(uuid.uuid4()), email="student_b@example.com")
NON_MEMBER = _FakeUser(id=str(uuid.uuid4()), email="nonmember@example.com")
CURRENT_USER: _FakeUser = COACH


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
            to_remove = [row for row in self.table.rows if self._matches(row)]
            for row in to_remove:
                self.table.rows.remove(row)
            return _FakeResponse(to_remove)

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
    monkeypatch.setattr(comments_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    fast_app = FastAPI()
    fast_app.include_router(comments_route.router, prefix="/api")

    async def _override() -> _FakeUser:
        if CURRENT_USER is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return CURRENT_USER

    fast_app.dependency_overrides[_real_get_current_user] = _override
    return fast_app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_user() -> None:
    global CURRENT_USER
    CURRENT_USER = COACH


def _setup_class_with_members(fake_supabase: _FakeSupabase) -> tuple[str, str]:
    """Create a class, add COACH and STUDENT_A as members. Returns (class_id, target_id)."""
    class_id = str(uuid.uuid4())
    target_id = str(uuid.uuid4())
    fake_supabase.table("classes").rows.append(
        {
            "id": class_id,
            "name": "Test Class",
            "join_code": "ABCDEF",
            "created_by": COACH.id,
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    )
    fake_supabase.table("class_members").rows.extend(
        [
            {
                "class_id": class_id,
                "user_id": COACH.id,
                "role": "coach",
                "joined_at": "2026-01-01T00:00:00+00:00",
            },
            {
                "class_id": class_id,
                "user_id": STUDENT_A.id,
                "role": "competitor",
                "joined_at": "2026-01-01T00:00:00+00:00",
            },
            {
                "class_id": class_id,
                "user_id": STUDENT_B.id,
                "role": "competitor",
                "joined_at": "2026-01-01T00:00:00+00:00",
            },
        ]
    )
    return class_id, target_id


def test_non_member_gets_403_on_list(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)
    # Seed one comment so there's something to list.
    fake_supabase.table("comments").rows.append(
        {
            "id": str(uuid.uuid4()),
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "author_id": STUDENT_A.id,
            "body": "Hello",
            "is_private": False,
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    )
    CURRENT_USER = NON_MEMBER
    resp = client.get(
        "/api/comments",
        params={"target_type": "assignment", "target_id": target_id},
    )
    assert resp.status_code == 403


def test_non_member_gets_403_on_post(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)
    CURRENT_USER = NON_MEMBER
    resp = client.post(
        "/api/comments",
        json={
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "body": "Should fail",
        },
    )
    assert resp.status_code == 403


def test_member_can_post_and_list_public_comment(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)
    CURRENT_USER = STUDENT_A
    post_resp = client.post(
        "/api/comments",
        json={
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "body": "Great assignment!",
            "is_private": False,
        },
    )
    assert post_resp.status_code == 200, post_resp.text
    comment_id = post_resp.json()["id"]

    list_resp = client.get(
        "/api/comments",
        params={"target_type": "assignment", "target_id": target_id},
    )
    assert list_resp.status_code == 200, list_resp.text
    ids = [c["id"] for c in list_resp.json()]
    assert comment_id in ids


def test_private_comment_hidden_from_other_student(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)

    # Student A posts a private comment.
    CURRENT_USER = STUDENT_A
    post_resp = client.post(
        "/api/comments",
        json={
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "body": "Private message to coach",
            "is_private": True,
        },
    )
    assert post_resp.status_code == 200, post_resp.text
    comment_id = post_resp.json()["id"]

    # Student A can see it.
    list_resp_a = client.get(
        "/api/comments",
        params={"target_type": "assignment", "target_id": target_id},
    )
    assert list_resp_a.status_code == 200
    assert any(c["id"] == comment_id for c in list_resp_a.json())

    # Student B cannot see Student A's private comment.
    CURRENT_USER = STUDENT_B
    list_resp_b = client.get(
        "/api/comments",
        params={"target_type": "assignment", "target_id": target_id},
    )
    assert list_resp_b.status_code == 200
    assert all(c["id"] != comment_id for c in list_resp_b.json())


def test_coach_can_see_private_comment(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)

    # Student A posts a private comment.
    CURRENT_USER = STUDENT_A
    post_resp = client.post(
        "/api/comments",
        json={
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "body": "Private message to coach",
            "is_private": True,
        },
    )
    assert post_resp.status_code == 200, post_resp.text
    comment_id = post_resp.json()["id"]

    # Coach sees it.
    CURRENT_USER = COACH
    list_resp = client.get(
        "/api/comments",
        params={"target_type": "assignment", "target_id": target_id},
    )
    assert list_resp.status_code == 200
    assert any(c["id"] == comment_id for c in list_resp.json())


def test_author_can_delete_own_comment(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)
    CURRENT_USER = STUDENT_A
    post_resp = client.post(
        "/api/comments",
        json={
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "body": "To be deleted",
        },
    )
    assert post_resp.status_code == 200
    comment_id = post_resp.json()["id"]

    del_resp = client.delete(f"/api/comments/{comment_id}")
    assert del_resp.status_code == 204


def test_other_student_cannot_delete_comment(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)
    CURRENT_USER = STUDENT_A
    post_resp = client.post(
        "/api/comments",
        json={
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "body": "Mine",
        },
    )
    assert post_resp.status_code == 200
    comment_id = post_resp.json()["id"]

    CURRENT_USER = STUDENT_B
    del_resp = client.delete(f"/api/comments/{comment_id}")
    assert del_resp.status_code == 403


def test_coach_can_delete_any_comment(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id, target_id = _setup_class_with_members(fake_supabase)
    CURRENT_USER = STUDENT_A
    post_resp = client.post(
        "/api/comments",
        json={
            "class_id": class_id,
            "target_type": "assignment",
            "target_id": target_id,
            "body": "Student comment",
        },
    )
    assert post_resp.status_code == 200
    comment_id = post_resp.json()["id"]

    CURRENT_USER = COACH
    del_resp = client.delete(f"/api/comments/{comment_id}")
    assert del_resp.status_code == 204
