"""Unit tests for the speed_passages seed migration + lookup service."""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from services import speed_passages as svc


# ---------------------------------------------------------------------------
# Fake Supabase client.
# ---------------------------------------------------------------------------


class _FakeQuery:
    def __init__(self, rows: list[dict[str, Any]], counter: dict[str, int]):
        self._rows = rows
        self._counter = counter
        self._result_rows = rows
        self._insert_payload: dict[str, Any] | None = None

    def select(self, *_a, **_kw) -> "_FakeQuery":
        return self

    def eq(self, column: str, value: Any) -> "_FakeQuery":
        self._result_rows = [
            row for row in self._result_rows if row.get(column) == value
        ]
        return self

    def limit(self, count: int) -> "_FakeQuery":
        self._result_rows = self._result_rows[:count]
        return self

    def order(self, *_a, **_kw) -> "_FakeQuery":
        return self

    def insert(self, payload: dict[str, Any]) -> "_FakeQuery":
        self._insert_payload = dict(payload)
        return self

    def execute(self) -> Any:
        self._counter["calls"] += 1
        if self._insert_payload is not None:
            self._rows.append({"id": str(len(self._rows) + 1), **self._insert_payload})
            return SimpleNamespace(data=[self._insert_payload])
        return SimpleNamespace(data=list(self._result_rows))


class _FakeSupabase:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = rows
        self.counter = {"calls": 0}

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self.rows, self.counter)


@pytest.fixture(autouse=True)
def _reset_state():
    """Clear module-level caches between tests."""

    svc.clear_cache()
    svc._reset_client_for_tests()
    yield
    svc.clear_cache()
    svc._reset_client_for_tests()


@pytest.fixture
def install_fake_client(monkeypatch):
    def _install(rows: list[dict[str, Any]]) -> _FakeSupabase:
        fake = _FakeSupabase(rows)
        monkeypatch.setattr(svc, "_get_service_client", lambda: fake)
        return fake

    return _install


# ---------------------------------------------------------------------------
# Service tests.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_passage_exact_match(install_fake_client):
    fake = install_fake_client(
        [
            {"id": "1", "target_words": 100, "text": "short passage"},
            {"id": "2", "target_words": 220, "text": "long passage"},
        ]
    )

    result = await svc.get_passage(220)

    assert result == "long passage"
    assert fake.counter["calls"] == 1


@pytest.mark.asyncio
async def test_get_passage_closest_match(install_fake_client):
    install_fake_client(
        [
            {"id": "1", "target_words": 100, "text": "short"},
            {"id": "2", "target_words": 220, "text": "long"},
            {"id": "3", "target_words": 150, "text": "medium"},
        ]
    )

    # 140 is closest to 150 (distance 10) vs 100 (40) and 220 (80).
    result = await svc.get_passage(140)

    assert result == "medium"


@pytest.mark.asyncio
async def test_get_passage_caches_result(install_fake_client):
    fake = install_fake_client(
        [{"id": "1", "target_words": 100, "text": "cached"}]
    )

    first = await svc.get_passage(100)
    second = await svc.get_passage(100)

    assert first == "cached"
    assert second == "cached"
    assert fake.counter["calls"] == 1, "second call should hit the cache"


@pytest.mark.asyncio
async def test_get_passage_empty_table_returns_none(install_fake_client):
    install_fake_client([])

    result = await svc.get_passage(120)

    assert result is None


@pytest.mark.asyncio
async def test_cache_evicts_when_full(install_fake_client):
    install_fake_client(
        [{"id": "1", "target_words": 100, "text": "only"}]
    )

    # Fill the cache past its max size to exercise eviction.
    for i in range(svc._CACHE_MAXSIZE + 5):
        await svc.get_passage(i)

    assert len(svc._passage_cache) <= svc._CACHE_MAXSIZE


@pytest.mark.asyncio
async def test_list_passages(install_fake_client):
    install_fake_client(
        [
            {"id": "a", "target_words": 100, "text": "first"},
            {"id": "b", "target_words": 200, "text": "second"},
        ]
    )

    passages = await svc.list_passages()

    assert len(passages) == 2
    assert passages[0].target_words == 100
    assert passages[0].text == "first"
    assert passages[1].id == "b"


@pytest.mark.asyncio
async def test_count_passages(install_fake_client):
    install_fake_client(
        [
            {"id": "a", "target_words": 100, "text": "first"},
            {"id": "b", "target_words": 200, "text": "second"},
        ]
    )

    assert await svc.count_passages() == 2


@pytest.mark.asyncio
async def test_count_passages_treats_uncategorized_as_debate(install_fake_client):
    install_fake_client(
        [
            {"id": "a", "target_words": 100, "text": "old debate"},
            {
                "id": "b",
                "target_words": 100,
                "text": "new debate",
                "category": "debate",
            },
            {"id": "c", "target_words": 100, "text": "soccer", "category": "sports"},
        ]
    )

    assert await svc.count_passages("debate") == 2
    assert await svc.count_passages("sports") == 1


@pytest.mark.asyncio
async def test_save_passage_inserts_new_text(install_fake_client):
    fake = install_fake_client([])

    inserted = await svc.save_passage(
        150, "new speed passage", category="sports", subtopic="soccer"
    )

    assert inserted is True
    assert fake.rows == [
        {
            "id": "1",
            "target_words": 150,
            "text": "new speed passage",
            "category": "sports",
            "subtopic": "soccer",
        }
    ]


@pytest.mark.asyncio
async def test_save_passage_skips_duplicate_text(install_fake_client):
    fake = install_fake_client(
        [{"id": "1", "target_words": 150, "text": "already stored"}]
    )

    inserted = await svc.save_passage(150, "already stored")

    assert inserted is False
    assert len(fake.rows) == 1


# ---------------------------------------------------------------------------
# Migration tests.
# ---------------------------------------------------------------------------


_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "0002_seed_speed_passages.sql"
)
_SOURCE_JSON = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "speed_passages.json"
)


def _load_source_passages() -> list[dict[str, Any]]:
    with _SOURCE_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def test_migration_file_exists():
    assert _MIGRATION_PATH.exists(), "seed migration must be present"


def test_migration_inserts_match_source_json():
    sql = _MIGRATION_PATH.read_text(encoding="utf-8")
    inserts = re.findall(
        r"INSERT INTO public\.speed_passages", sql, flags=re.IGNORECASE
    )

    source = _load_source_passages()
    assert len(inserts) == len(source), (
        f"expected {len(source)} INSERT statements, found {len(inserts)}"
    )

    # Each source prompt's opening words should appear inside the SQL so we
    # know the right text was emitted, not a placeholder.
    for passage in source:
        head = " ".join(passage["prompt"].split()[:6])
        assert head in sql, f"missing passage text starting with: {head!r}"


def test_migration_uses_dollar_quoted_literals():
    """Dollar-quoting sidesteps single-quote escaping bugs."""

    sql = _MIGRATION_PATH.read_text(encoding="utf-8")
    assert "$p$" in sql, "expected dollar-quoted string literals"
