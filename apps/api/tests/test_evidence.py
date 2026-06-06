from __future__ import annotations

from types import SimpleNamespace

import pytest

from services import evidence as evidence_service


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, table, op, payload=None):
        self.table = table
        self.op = op
        self.payload = payload
        self.filters = []
        self.limit_n = None

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def execute(self):
        if self.op == "select":
            rows = [
                row for row in self.table.rows
                if all(row.get(field) == value for field, value in self.filters)
            ]
            if self.limit_n is not None:
                rows = rows[: self.limit_n]
            return _FakeResponse(rows)
        if self.op == "upsert":
            existing = None
            for row in self.table.rows:
                if row.get("cache_key") == self.payload.get("cache_key"):
                    existing = row
                    break
            if existing is None:
                existing = dict(self.payload)
                self.table.rows.append(existing)
            else:
                existing.update(self.payload)
            return _FakeResponse([existing])
        raise AssertionError(f"unknown op {self.op}")


class _FakeTable:
    def __init__(self):
        self.rows = []

    def select(self, *_args, **_kwargs):
        return _FakeQuery(self, "select")

    def upsert(self, payload, **_kwargs):
        return _FakeQuery(self, "upsert", payload)


class _FakeSupabase:
    def __init__(self):
        self.tables = {}

    def table(self, name):
        if name not in self.tables:
            self.tables[name] = _FakeTable()
        return self.tables[name]


@pytest.mark.asyncio
async def test_get_topic_evidence_fetches_then_caches(monkeypatch: pytest.MonkeyPatch):
    fake_supabase = _FakeSupabase()
    monkeypatch.setattr(evidence_service, "get_supabase", lambda: fake_supabase)

    async def fake_search_tavily(_query: str):
        return [
            {
                "title": "Brookings",
                "url": "https://example.com/brookings",
                "raw_content": "NATO members spent 2% of GDP on defense in 2024, raising deterrence costs.",
            }
        ]

    async def fake_create(**_kwargs):
        return SimpleNamespace(
            output_text=(
                '{"cards":[{"tag":"Deterrence works","evidence":"NATO members spent 2% of GDP on defense in 2024, raising deterrence costs.","source_title":"Brookings","source_url":"https://example.com/brookings","source_type":"ngo"}]}'
            )
        )

    monkeypatch.setattr(evidence_service, "_search_tavily", fake_search_tavily)
    fake_client = SimpleNamespace(
        responses=SimpleNamespace(create=fake_create)
    )
    monkeypatch.setattr(evidence_service, "client", fake_client)

    first = await evidence_service.get_topic_evidence("Ukraine and NATO", "neg")
    second = await evidence_service.get_topic_evidence("Ukraine and NATO", "neg")

    assert first is not None
    assert second is not None
    assert len(first.cards) == 1
    assert second.cards[0].source_title == "Brookings"
    assert len(fake_supabase.table("topic_evidence_cache").rows) == 1


@pytest.mark.asyncio
async def test_get_topic_evidence_filters_non_quantitative_cards(monkeypatch: pytest.MonkeyPatch):
    fake_supabase = _FakeSupabase()
    monkeypatch.setattr(evidence_service, "get_supabase", lambda: fake_supabase)

    async def fake_search_tavily(_query: str):
        return [
            {
                "title": "Think Tank",
                "url": "https://example.com/vague",
                "raw_content": "Infrastructure can improve trade and investment.",
            },
            {
                "title": "World Bank",
                "url": "https://example.com/worldbank",
                "raw_content": "Trade volume rose 18% between 2021 and 2024 after border reforms.",
            },
        ]

    async def fake_create(**_kwargs):
        return SimpleNamespace(
            output_text=(
                '{"cards":['
                '{"tag":"Too vague","evidence":"Infrastructure can improve trade and investment.","source_title":"Think Tank","source_url":"https://example.com/vague","source_type":"ngo"},'
                '{"tag":"Quantified","evidence":"Trade volume rose 18% between 2021 and 2024 after border reforms.","source_title":"World Bank","source_url":"https://example.com/worldbank","source_type":"academic"}'
                ']}'
            )
        )

    monkeypatch.setattr(evidence_service, "_search_tavily", fake_search_tavily)
    fake_client = SimpleNamespace(
        responses=SimpleNamespace(create=fake_create)
    )
    monkeypatch.setattr(evidence_service, "client", fake_client)

    evidence = await evidence_service.get_topic_evidence("Test topic", "aff")

    assert evidence is not None
    assert len(evidence.cards) == 1
    assert evidence.cards[0].tag == "Quantified"


@pytest.mark.asyncio
async def test_get_prompt_block_falls_back_without_evidence(monkeypatch: pytest.MonkeyPatch):
    async def fake_get_topic_evidence(_topic: str, _side: str):
        return None

    monkeypatch.setattr(evidence_service, "get_topic_evidence", fake_get_topic_evidence)

    block = await evidence_service.get_prompt_block("Test topic", "aff")

    assert "Do not invent studies" in block


@pytest.mark.asyncio
async def test_build_tavily_query_mentions_side():
    aff_query = evidence_service._build_tavily_query("Homework does more harm than good", "aff")
    neg_query = evidence_service._build_tavily_query("Homework does more harm than good", "neg")

    assert "affirmative" in aff_query
    assert "negative" in neg_query
