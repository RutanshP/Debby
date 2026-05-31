from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import saved_cases as saved_cases_route
from services import saved_cases as saved_cases_service


class _FakeUser(BaseModel):
    id: str
    email: str | None = None


USER_A = _FakeUser(id=str(uuid.uuid4()), email="a@example.com")
USER_B = _FakeUser(id=str(uuid.uuid4()), email="b@example.com")
CURRENT_USER: _FakeUser | None = USER_A


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
        self.range_start: int | None = None
        self.range_end: int | None = None

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
        self.range_start = start
        self.range_end = end
        return self

    def _matches(self, row: dict) -> bool:
        return all(row.get(field) == value for field, value in self.filters)

    def execute(self) -> _FakeResponse:
        if self.op == "insert":
            row = {
                "id": str(uuid.uuid4()),
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
                **self.payload,
            }
            self.table.rows.append(row)
            return _FakeResponse([row])
        if self.op == "select":
            matched = [row for row in self.table.rows if self._matches(row)]
            if self.order_field:
                matched.sort(
                    key=lambda row: row.get(self.order_field) or "",
                    reverse=self.order_desc,
                )
            if self.range_start is not None:
                end = self.range_end if self.range_end is not None else len(matched) - 1
                matched = matched[self.range_start : end + 1]
            elif self.limit_n is not None:
                matched = matched[: self.limit_n]
            return _FakeResponse(matched)
        if self.op == "delete":
            deleted = [row for row in self.table.rows if self._matches(row)]
            self.table.rows = [row for row in self.table.rows if not self._matches(row)]
            return _FakeResponse(deleted)
        raise AssertionError(f"unknown op {self.op}")


class _FakeTable:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def insert(self, payload: dict) -> _FakeQuery:
        return _FakeQuery(self, "insert", payload)

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return _FakeQuery(self, "select")

    def delete(self) -> _FakeQuery:
        return _FakeQuery(self, "delete")


class _FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, _FakeTable] = {}

    def table(self, name: str) -> _FakeTable:
        return self.tables.setdefault(name, _FakeTable())


@pytest.fixture
def fake_supabase(monkeypatch: pytest.MonkeyPatch) -> _FakeSupabase:
    fake = _FakeSupabase()
    monkeypatch.setattr(saved_cases_service, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    app = FastAPI()
    app.include_router(saved_cases_route.router, prefix="/api")

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
    CURRENT_USER = USER_A


def test_create_saved_case_scopes_to_user(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    resp = client.post(
        "/api/saved-cases",
        json={
            "title": "Aff Case",
            "topic": "AI policy",
            "format": "parli",
            "side": "aff",
            "content": "# Case",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] == USER_A.id
    assert body["content"] == "# Case"
    assert fake_supabase.tables["saved_cases"].rows[0]["user_id"] == USER_A.id


def test_list_saved_cases_only_returns_owner(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    table = fake_supabase.tables.setdefault("saved_cases", _FakeTable())
    table.rows.extend(
        [
            {
                "id": str(uuid.uuid4()),
                "user_id": USER_A.id,
                "title": "mine",
                "topic": "topic",
                "format": "parli",
                "side": "aff",
                "content": "secret",
                "created_at": "2026-01-02T00:00:00+00:00",
            },
            {
                "id": str(uuid.uuid4()),
                "user_id": USER_B.id,
                "title": "theirs",
                "topic": "topic",
                "format": "parli",
                "side": "neg",
                "content": "private",
                "created_at": "2026-01-03T00:00:00+00:00",
            },
        ]
    )

    resp = client.get("/api/saved-cases")

    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["title"] == "mine"
    assert "content" not in rows[0]


def test_get_and_delete_saved_case(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    case_id = str(uuid.uuid4())
    table = fake_supabase.tables.setdefault("saved_cases", _FakeTable())
    table.rows.append(
        {
            "id": case_id,
            "user_id": USER_A.id,
            "title": "mine",
            "topic": "topic",
            "format": "mspdp",
            "side": "neg",
            "content": "# Saved",
            "created_at": "2026-01-02T00:00:00+00:00",
        }
    )

    get_resp = client.get(f"/api/saved-cases/{case_id}")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["content"] == "# Saved"

    delete_resp = client.delete(f"/api/saved-cases/{case_id}")
    assert delete_resp.status_code == 204
    assert table.rows == []
