from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps.auth import get_current_user as _real_get_current_user
from routes import classroom as classroom_route
from services import classroom as classroom_service
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

    def in_(self, field: str, values: list[Any]) -> "_FakeQuery":
        self.filters.append((field, set(values)))
        return self

    def order(self, field: str, desc: bool = False) -> "_FakeQuery":
        self.order_field = field
        self.order_desc = desc
        return self

    def limit(self, n: int) -> "_FakeQuery":
        self.limit_n = n
        return self

    def _matches(self, row: dict) -> bool:
        for field, value in self.filters:
            if isinstance(value, set):
                if row.get(field) not in value:
                    return False
            elif row.get(field) != value:
                return False
        return True

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
    return fake


@pytest.fixture
def app(fake_supabase: _FakeSupabase) -> FastAPI:
    app = FastAPI()
    app.include_router(classroom_route.router, prefix="/api")

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
    created = client.post("/api/classes", json={"name": "Varsity Parli"})
    assert created.status_code == 200, created.text
    join_code = created.json()["join_code"]
    CURRENT_USER = STUDENT
    joined = client.post("/api/classes/join", json={"join_code": join_code.lower()})
    assert joined.status_code == 200, joined.text
    CURRENT_USER = COACH
    return created.json()["id"]


def _create_drill_assignment(client: TestClient, class_id: str) -> str:
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
    return resp.json()["recipients"][0]["id"]


def test_coach_can_create_class_and_student_can_join(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    class_id = _create_class_and_join_student(client)
    assert len(fake_supabase.table("classes").rows) == 1
    members = fake_supabase.table("class_members").rows
    assert {row["role"] for row in members if row["class_id"] == class_id} == {
        "coach",
        "competitor",
    }


def test_coach_can_create_assignment_and_student_lists_it(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    recipient_id = _create_drill_assignment(client, class_id)

    CURRENT_USER = STUDENT
    resp = client.get("/api/assignments")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["recipient"]["id"] == recipient_id
    assert body[0]["assignment"]["payload"]["drill_type"] == "rebuttal"


def test_assignment_instructions_round_trip_to_student(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)

    create = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Impact drill",
            "type": "drill",
            "payload": {"drill_type": "impact", "timer_seconds": 60},
            "instructions": "Focus on magnitude first, then weigh it against timeframe.",
            "assign_all": True,
        },
    )
    assert create.status_code == 200, create.text

    CURRENT_USER = STUDENT
    resp = client.get("/api/assignments")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body[0]["assignment"]["instructions"] == (
        "Focus on magnitude first, then weigh it against timeframe."
    )


def test_class_detail_lists_newest_assignments_first(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)

    first = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Older assignment",
            "type": "drill",
            "payload": {"drill_type": "rebuttal", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    assert first.status_code == 200, first.text

    second = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Newer assignment",
            "type": "drill",
            "payload": {"drill_type": "impact", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    assert second.status_code == 200, second.text

    assignments_table = fake_supabase.table("assignments").rows
    assignments_table[0]["created_at"] = "2026-01-01T00:00:00+00:00"
    assignments_table[1]["created_at"] = "2026-01-02T00:00:00+00:00"

    CURRENT_USER = COACH
    coach_detail = client.get(f"/api/classes/{class_id}")
    assert coach_detail.status_code == 200, coach_detail.text
    coach_titles = [row["assignment"]["title"] for row in coach_detail.json()["assignments"]]
    assert coach_titles[:2] == ["Newer assignment", "Older assignment"]

    CURRENT_USER = STUDENT
    student_detail = client.get(f"/api/classes/{class_id}")
    assert student_detail.status_code == 200, student_detail.text
    student_titles = [row["assignment"]["title"] for row in student_detail.json()["assignments"]]
    assert student_titles[:2] == ["Newer assignment", "Older assignment"]


def test_student_cannot_create_assignment(client: TestClient) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    CURRENT_USER = STUDENT
    resp = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Nope",
            "type": "drill",
            "payload": {"drill_type": "impact", "timer_seconds": 60},
            "assign_all": True,
        },
    )
    assert resp.status_code == 403


def test_student_cannot_read_or_complete_someone_elses_assignment(
    client: TestClient,
) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    recipient_id = _create_drill_assignment(client, class_id)

    CURRENT_USER = OTHER
    get_resp = client.get(f"/api/assignments/{recipient_id}")
    complete_resp = client.post(
        f"/api/assignments/{recipient_id}/complete",
        json={"drill_id": str(uuid.uuid4())},
    )
    assert get_resp.status_code == 404
    assert complete_resp.status_code == 404


def test_drill_completion_requires_current_user_owned_drill(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    recipient_id = _create_drill_assignment(client, class_id)
    drill_id = str(uuid.uuid4())
    fake_supabase.table("drills").rows.append(
        {
            "id": drill_id,
            "user_id": OTHER.id,
            "drill_type": "rebuttal",
            "prompt": {},
            "score": {"score": 7},
        }
    )

    CURRENT_USER = STUDENT
    resp = client.post(
        f"/api/assignments/{recipient_id}/complete",
        json={"drill_id": drill_id},
    )
    assert resp.status_code == 403


def test_student_completes_drill_and_coach_sees_result(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    recipient_id = _create_drill_assignment(client, class_id)
    drill_id = str(uuid.uuid4())
    fake_supabase.table("drills").rows.append(
        {
            "id": drill_id,
            "user_id": STUDENT.id,
            "drill_type": "rebuttal",
            "prompt": {"title": "Rebuttal"},
            "score": {"score": 8, "feedback": "Good clash."},
        }
    )

    CURRENT_USER = STUDENT
    complete = client.post(
        f"/api/assignments/{recipient_id}/complete",
        json={"drill_id": drill_id},
    )
    assert complete.status_code == 200, complete.text
    assert complete.json()["recipient"]["status"] == "completed"

    CURRENT_USER = COACH
    detail = client.get(f"/api/classes/{class_id}")
    assert detail.status_code == 200, detail.text
    assignment = detail.json()["assignments"][0]
    assert assignment["recipients"][0]["status"] == "completed"
    assert assignment["results"][recipient_id]["score"]["score"] == 8


def test_standalone_drill_can_complete_matching_assignment(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    recipient_id = _create_drill_assignment(client, class_id)
    drill_id = str(uuid.uuid4())
    fake_supabase.table("drills").rows.append(
        {
            "id": drill_id,
            "user_id": STUDENT.id,
            "drill_type": "rebuttal",
            "prompt": {"title": "Rebuttal"},
            "timer_seconds": 60,
            "score": {"score": 8, "feedback": "Good clash."},
        }
    )

    CURRENT_USER = STUDENT
    complete = client.post(
        "/api/assignments/complete-matching-drill",
        json={"drill_id": drill_id},
    )
    assert complete.status_code == 200, complete.text
    assert complete.json()["recipient"]["id"] == recipient_id
    assert complete.json()["recipient"]["status"] == "completed"


def test_standalone_drill_does_not_complete_non_matching_assignment(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    _create_drill_assignment(client, class_id)
    drill_id = str(uuid.uuid4())
    fake_supabase.table("drills").rows.append(
        {
            "id": drill_id,
            "user_id": STUDENT.id,
            "drill_type": "impact",
            "prompt": {"title": "Impact"},
            "timer_seconds": 60,
            "score": {"score": 6, "feedback": "Needs weighing."},
        }
    )

    CURRENT_USER = STUDENT
    complete = client.post(
        "/api/assignments/complete-matching-drill",
        json={"drill_id": drill_id},
    )
    assert complete.status_code == 200, complete.text
    assert complete.json() is None


def test_practice_assignment_start_creates_round_and_complete_links_it(
    client: TestClient,
    fake_supabase: _FakeSupabase,
) -> None:
    global CURRENT_USER
    class_id = _create_class_and_join_student(client)
    create = client.post(
        f"/api/classes/{class_id}/assignments",
        json={
            "title": "Assigned round",
            "type": "practice_round",
            "payload": {
                "format": "parli",
                "topic": "Resolved: Schools should ban phones.",
                "side": "aff",
                "speech_duration_seconds": 120,
            },
            "assign_all": True,
        },
    )
    assert create.status_code == 200, create.text
    recipient_id = create.json()["recipients"][0]["id"]

    CURRENT_USER = STUDENT
    started = client.post(f"/api/assignments/{recipient_id}/start")
    assert started.status_code == 200, started.text
    round_id = started.json()["round_id"]
    assert fake_supabase.table("rounds").rows[0]["id"] == round_id
    completed = client.post(
        f"/api/assignments/{recipient_id}/complete",
        json={"round_id": round_id},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["recipient"]["status"] == "completed"
