from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import profiles as profiles_route
from services import profiles as profiles_service


class _FakeUser(BaseModel):
    id: str
    email: str | None = None


USER_A = _FakeUser(id=str(uuid.uuid4()), email="a@example.com")
USER_B = _FakeUser(id=str(uuid.uuid4()), email="b@example.com")
CURRENT_USER: _FakeUser = USER_A


class _FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class _FakeQuery:
    def __init__(self, table: "_FakeTable", op: str, payload: Any = None) -> None:
        self.table = table
        self.op = op
        self.payload = payload
        self.filters: list[tuple[str, Any]] = []
        self.in_filters: list[tuple[str, list[Any]]] = []
        self.cols: str = "*"

    def eq(self, field: str, value: Any) -> "_FakeQuery":
        self.filters.append((field, value))
        return self

    def in_(self, field: str, values: list[Any]) -> "_FakeQuery":
        self.in_filters.append((field, values))
        return self

    def select(self, cols: str = "*", *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        self.cols = cols
        return self

    def limit(self, n: int) -> "_FakeQuery":
        self._limit = n
        return self

    def _matches(self, row: dict) -> bool:
        for field, value in self.filters:
            if row.get(field) != value:
                return False
        for field, values in self.in_filters:
            if row.get(field) not in values:
                return False
        return True

    def execute(self) -> _FakeResponse:
        if self.op == "upsert":
            # Find existing row with same primary key (user_id for profiles)
            pk_field = "user_id"
            pk_value = self.payload.get(pk_field)
            for row in self.table.rows:
                if row.get(pk_field) == pk_value:
                    row.update(self.payload)
                    return _FakeResponse([row])
            row = {
                "created_at": "2026-01-01T00:00:00+00:00",
                **self.payload,
            }
            self.table.rows.append(row)
            return _FakeResponse([row])

        if self.op == "select":
            rows = [row for row in self.table.rows if self._matches(row)]
            if hasattr(self, "_limit"):
                rows = rows[: self._limit]
            # Filter columns if not "*"
            if self.cols != "*":
                col_list = [c.strip() for c in self.cols.split(",")]
                rows = [{c: r.get(c) for c in col_list} for r in rows]
            return _FakeResponse(rows)

        raise AssertionError(f"unknown op {self.op}")


class _FakeTable:
    def __init__(self, name: str) -> None:
        self.name = name
        self.rows: list[dict] = []

    def upsert(self, payload: dict) -> _FakeQuery:
        return _FakeQuery(self, "upsert", payload)

    def select(self, cols: str = "*", *args: Any, **kwargs: Any) -> _FakeQuery:
        q = _FakeQuery(self, "select")
        q.cols = cols
        return q

    def insert(self, payload: dict) -> _FakeQuery:
        q = _FakeQuery(self, "insert", payload)
        return q


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
    monkeypatch.setattr(profiles_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    _app = FastAPI()
    _app.include_router(profiles_route.router, prefix="/api")

    async def _override() -> _FakeUser:
        return CURRENT_USER

    _app.dependency_overrides[_real_get_current_user] = _override
    return _app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_user() -> None:
    global CURRENT_USER
    CURRENT_USER = USER_A


def test_get_profile_returns_empty_when_no_profile(client: TestClient) -> None:
    resp = client.get("/api/me/profile")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] == USER_A.id
    assert body["display_name"] is None


def test_upsert_then_get_returns_display_name(client: TestClient) -> None:
    put = client.put("/api/me/profile", json={"display_name": "Alice Debater"})
    assert put.status_code == 200, put.text
    assert put.json()["display_name"] == "Alice Debater"

    get = client.get("/api/me/profile")
    assert get.status_code == 200, get.text
    assert get.json()["display_name"] == "Alice Debater"


def test_upsert_twice_updates_name(client: TestClient) -> None:
    client.put("/api/me/profile", json={"display_name": "First Name"})
    client.put("/api/me/profile", json={"display_name": "Updated Name"})
    get = client.get("/api/me/profile")
    assert get.json()["display_name"] == "Updated Name"


def _share_class(fake_supabase: _FakeSupabase, *user_ids: str, class_id: str = "class-1") -> None:
    """Seed class_members rows so the given users share a class."""
    members = fake_supabase.table("class_members")
    for uid in user_ids:
        members.rows.append({"class_id": class_id, "user_id": uid, "role": "competitor"})


def test_lookup_returns_map(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    global CURRENT_USER
    # Seed profiles for two users directly.
    fake_supabase.table("profiles").rows.append(
        {"user_id": USER_A.id, "display_name": "Alice"}
    )
    fake_supabase.table("profiles").rows.append(
        {"user_id": USER_B.id, "display_name": "Bob"}
    )
    # A and B share a class, so A may resolve B's name.
    _share_class(fake_supabase, USER_A.id, USER_B.id)

    resp = client.post(
        "/api/profiles/lookup",
        json={"user_ids": [USER_A.id, USER_B.id]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body[USER_A.id] == "Alice"
    assert body[USER_B.id] == "Bob"


def test_lookup_omits_non_classmates(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    # B has a profile but shares no class with A → must not be resolvable.
    fake_supabase.table("profiles").rows.append(
        {"user_id": USER_A.id, "display_name": "Alice"}
    )
    fake_supabase.table("profiles").rows.append(
        {"user_id": USER_B.id, "display_name": "Bob"}
    )
    _share_class(fake_supabase, USER_A.id)  # A is in a class, B is not

    resp = client.post(
        "/api/profiles/lookup",
        json={"user_ids": [USER_A.id, USER_B.id]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get(USER_A.id) == "Alice"
    assert USER_B.id not in body


def test_lookup_omits_unknown_ids(client: TestClient, fake_supabase: _FakeSupabase) -> None:
    fake_supabase.table("profiles").rows.append(
        {"user_id": USER_A.id, "display_name": "Alice"}
    )
    unknown_id = str(uuid.uuid4())
    resp = client.post(
        "/api/profiles/lookup",
        json={"user_ids": [USER_A.id, unknown_id]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert USER_A.id in body
    assert unknown_id not in body


def test_lookup_empty_list_returns_empty(client: TestClient) -> None:
    resp = client.post("/api/profiles/lookup", json={"user_ids": []})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
