"""Tests for the AI service + routes. All OpenAI calls are mocked."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

import main
from models.flow import FlowBallot
from routes import ai as ai_route
from services import ai as ai_service


# --- helpers ------------------------------------------------------------------


def _chat_completion(content: str):
    """Build a minimal object shaped like an OpenAI ChatCompletion."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


class _AsyncStream:
    """Async iterator producing fake streaming chunks."""

    def __init__(self, tokens: list[str]):
        self._tokens = tokens

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for tok in self._tokens:
            yield SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content=tok))]
            )


@pytest.fixture
def patched_client(monkeypatch: pytest.MonkeyPatch):
    """Replace the shared client's chat.completions.create with an AsyncMock."""
    fake_create = AsyncMock()
    fake = MagicMock()
    fake.chat.completions.create = fake_create
    monkeypatch.setattr(ai_service, "client", fake)
    return fake_create


# --- service unit tests -------------------------------------------------------


async def test_ai_speech_returns_string(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("hello debaters")
    out = await ai_service.ai_speech("AI in schools")
    assert out == "hello debaters"
    patched_client.assert_awaited_once()


async def test_ai_response_returns_string(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("neg rebuttal")
    out = await ai_service.ai_response("topic", "aff speech text")
    assert out == "neg rebuttal"


async def test_ai_response_prompt_prioritizes_case_then_refutation(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion("neg speech")
    await ai_service.ai_response("topic", "aff speech text")

    messages = patched_client.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    assert "present Debby's own negative contentions" in user_prompt
    assert "refute the affirmative's major contentions" in user_prompt
    assert "cross-apply" in user_prompt


async def test_ai_aff_rebuttal_returns_short_rebuttal_only_prompt(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion("aff rebuttal")
    out = await ai_service.ai_aff_rebuttal("topic", "aff speech", "neg speech")
    assert out == "aff rebuttal"

    messages = patched_client.await_args.kwargs["messages"]
    assert "giving your second affirmative speech" in messages[0]["content"]
    assert "Do not introduce a new constructive case" in messages[0]["content"]
    assert "First rebut the negative's strongest actual arguments" in messages[1]["content"]
    assert "least refuted by the negative" in messages[1]["content"]
    assert "Output only this single speech" in messages[1]["content"]


async def test_ai_response_stream_yields_chunks(patched_client: AsyncMock):
    patched_client.return_value = _AsyncStream(["Hello ", "my name ", "is Debby."])
    tokens = [t async for t in ai_service.ai_response_stream("t", "speech")]
    assert tokens == ["Hello ", "my name ", "is Debby."]


async def test_winner_structured_output(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion(
        json.dumps({"winner_side": "aff", "rfd": "Better impacts on healthcare."})
    )
    verdict = await ai_service.winner("aff", "neg", "aff2", "topic")
    assert verdict.winner_side == "aff"
    assert "healthcare" in verdict.rfd
    kwargs = patched_client.await_args.kwargs
    assert kwargs["model"] == "gpt-5.4-mini"
    assert kwargs["reasoning_effort"] == "low"
    assert kwargs["max_completion_tokens"] == 2000


async def test_winner_retries_fallback_model_on_empty_output(
    patched_client: AsyncMock,
):
    patched_client.side_effect = [
        _chat_completion(""),
        _chat_completion(json.dumps({"winner_side": "neg", "rfd": "Neg outweighs."})),
    ]

    verdict = await ai_service.winner("aff", "neg", "aff2", "topic")

    assert verdict.winner_side == "neg"
    assert patched_client.await_args_list[0].kwargs["model"] == "gpt-5.4-mini"
    assert patched_client.await_args_list[1].kwargs["model"] == ai_service.MODEL
    assert patched_client.await_args_list[1].kwargs["max_tokens"] == 900


async def test_winner_prompt_allows_nuanced_rfd_and_keeps_it_separate_from_flow(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion(
        json.dumps(
            {
                "winner_side": "aff",
                "rfd": "Winning contention: Healthcare.\nWhy it won: It was extended.\nImpact comparison: It outweighs.",
            }
        )
    )
    await ai_service.winner("aff", "neg", "aff2", "topic")

    system_prompt = patched_client.await_args.kwargs["messages"][0]["content"]
    user_prompt = patched_client.await_args.kwargs["messages"][1]["content"]
    assert "not a flow sheet" in system_prompt
    assert "under 220 words" in system_prompt
    assert "Refutation quality" in system_prompt
    assert "Dropped/residual offense" in system_prompt
    assert "Merely repeating" in system_prompt
    assert "Do not infer, repair, or invent" in system_prompt
    assert "not an automatic win" in system_prompt
    assert "partially refutes" in system_prompt
    assert "remaining offense" in system_prompt
    assert "probability and warranting" in system_prompt
    assert "not in the RFD" in user_prompt
    assert "qualify the strength of the key refutations" in user_prompt
    assert "dropped or residual offense" in user_prompt
    assert "partial refutation/residual offense" in user_prompt


async def test_winner_prompt_disallows_incoherent_aff_win(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion(
        json.dumps(
            {
                "winner_side": "neg",
                "rfd": "Winning contention: None.\nWhy it won: No side made a judgeable topical argument.\nImpact comparison: No impacts were weighed.",
            }
        )
    )
    verdict = await ai_service.winner(
        "I like pizza and my weekend was fun.",
        "This is also unrelated.",
        "Nothing about the topic.",
        "China is a greater threat to the US than Iran.",
    )
    assert verdict.winner_side == "neg"


async def test_winner_accepts_legacy_for_against(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion(
        json.dumps({"winner_side": "against", "rfd": "neg wins"})
    )
    verdict = await ai_service.winner("a", "b", "c", "t")
    assert verdict.winner_side == "neg"


async def test_winner_malformed_json_raises(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("not json {{{")
    with pytest.raises(ValueError, match="malformed JSON"):
        await ai_service.winner("a", "b", "c", "t")


async def test_winner_missing_inputs_raises(patched_client: AsyncMock):
    with pytest.raises(ValueError):
        await ai_service.winner("", "neg", "aff2", "topic")


async def test_generate_round_flow_returns_model(patched_client: AsyncMock):
    payload = {
        "aff_sheet": [
            {
                "contention": {"tag": "Econ growth", "summary": "Helps GDP."},
                "neg_responses": [{"tag": "Inflation", "summary": "Hurts prices."}],
                "aff_defense": [],
                "status": "contested",
                "judge_note": "Both sides clashed.",
            }
        ],
        "neg_sheet": [
            {
                "contention": {"tag": "Inequality", "summary": "Top 1% gains."},
                "aff_rebuttals": [],
                "status": "unrefuted",
                "judge_note": "Dropped by aff.",
            }
        ],
        "ballot": {
            "aff_unrefuted": 0,
            "neg_unrefuted": 1,
            "winner": "neg",
            "explanation": "Neg dropped contention carries.",
        },
        "dropped": [],
        "voters": [{"tag": "Impact", "winner": "neg", "reason": "Bigger econ harm."}],
        "recommended_drills": ["rebuttal", "impact"],
    }
    patched_client.return_value = _chat_completion(json.dumps(payload))

    flow = await ai_service.generate_round_flow("topic", "aff", "neg", "aff2", "rfd")
    assert isinstance(flow, FlowBallot)
    assert len(flow.aff_sheet) == 1
    assert len(flow.neg_sheet) == 1
    assert flow.ballot.winner == "neg"
    assert flow.recommended_drills == ["rebuttal", "impact"]


async def test_flow_prompt_requires_nuanced_refutation_and_weighing(
    patched_client: AsyncMock,
):
    payload = {
        "aff_sheet": [],
        "neg_sheet": [],
        "ballot": {
            "aff_unrefuted": 0,
            "neg_unrefuted": 0,
            "winner": "aff",
            "explanation": "Aff retains residual offense.",
        },
        "dropped": [],
        "voters": [],
        "recommended_drills": ["impact"],
    }
    patched_client.return_value = _chat_completion(json.dumps(payload))

    await ai_service.generate_round_flow("topic", "aff", "neg", "aff2", "rfd")

    system_prompt = patched_client.await_args.kwargs["messages"][0]["content"]
    assert "partially refutes" in system_prompt
    assert "residual offense" in system_prompt
    assert "not treat dropped arguments as automatic winners" in system_prompt
    assert "probability and warranting" in system_prompt
    assert "do not decide only by counting unrefuted contentions" in system_prompt


async def test_generate_round_flow_accepts_legacy_loose_strings(patched_client: AsyncMock):
    payload = {
        "aff_sheet": [
            {
                "contention": "Investment is key for business growth.",
                "neg_responses": ["Financial burden of going green."],
                "aff_defense": "Long-term returns outweigh short-term costs.",
                "status": "contested",
            }
        ],
        "neg_sheet": [
            {
                "contention": "Market competitiveness issues.",
                "aff_rebuttals": "Green branding attracts customers.",
            }
        ],
        "ballot": {"winner": "for", "explanation": "Aff does more weighing."},
        "voters": ["Aff outweighs on long-term growth."],
        "recommended_drills": ["rebuttal", "nonsense", "impact"],
    }
    patched_client.return_value = _chat_completion(json.dumps(payload))

    flow = await ai_service.generate_round_flow("topic", "aff", "neg", "aff2", "rfd")

    assert flow.aff_sheet[0].contention.tag == "Investment is key for business growth."
    assert flow.aff_sheet[0].aff_defense[0].summary.startswith("Long-term returns")
    assert flow.neg_sheet[0].aff_rebuttals[0].tag.startswith("Green branding")
    assert flow.ballot.winner == "aff"
    assert flow.voters[0].winner == "aff"
    assert flow.recommended_drills == ["rebuttal", "impact"]


async def test_generate_round_flow_filters_topic_restatements(patched_client: AsyncMock):
    payload = {
        "aff_sheet": [
            {
                "contention": {
                    "tag": "Greater threat to the US than Iran",
                    "summary": "Greater threat to the US than Iran.",
                },
                "neg_responses": [],
                "aff_defense": [],
            },
            {
                "contention": {
                    "tag": "Technological growth",
                    "summary": "China's AI and chip investment increases military risk.",
                },
                "neg_responses": [],
                "aff_defense": [],
            },
        ],
        "neg_sheet": [],
        "voters": [],
        "dropped": [],
    }
    patched_client.return_value = _chat_completion(json.dumps(payload))
    flow = await ai_service.generate_round_flow(
        "China is a greater threat to the US than Iran.",
        "aff",
        "neg",
        "aff2",
        "rfd",
    )
    assert len(flow.aff_sheet) == 1
    assert flow.aff_sheet[0].contention.tag == "Technological growth"


async def test_generate_round_flow_malformed_json_raises(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("definitely not json")
    with pytest.raises(ValueError, match="malformed JSON"):
        await ai_service.generate_round_flow("t", "a", "n", "a2", "r")


async def test_generate_round_flow_caps_lists(patched_client: AsyncMock):
    rows_aff = [
        {
            "contention": {"tag": f"a{i}", "summary": "s"},
            "neg_responses": [],
            "aff_defense": [],
            "status": "contested",
            "judge_note": "n",
        }
        for i in range(8)
    ]
    payload = {"aff_sheet": rows_aff, "neg_sheet": [], "voters": [], "dropped": []}
    patched_client.return_value = _chat_completion(json.dumps(payload))
    flow = await ai_service.generate_round_flow("t", "a", "n", "a2", "r")
    assert len(flow.aff_sheet) == 4


async def test_generate_round_flow_recommends_filler_from_metrics(
    patched_client: AsyncMock,
):
    payload = {
        "aff_sheet": [],
        "neg_sheet": [],
        "voters": [],
        "dropped": [],
        "recommended_drills": ["impact"],
    }
    patched_client.return_value = _chat_completion(json.dumps(payload))

    flow = await ai_service.generate_round_flow(
        "topic",
        "aff",
        "neg",
        "aff2",
        "rfd",
        speech_metrics={"aff": {"filler_count": 4, "filler_per_minute": 5.0}},
    )

    assert "filler" in flow.recommended_drills


# --- route tests --------------------------------------------------------------


def _override_user():
    return ai_route.User(id="user-1", email="u@example.com")


@pytest.fixture
def client_authed():
    main.app.dependency_overrides[ai_route.get_current_user] = _override_user
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.pop(ai_route.get_current_user, None)


@pytest.fixture
def client_unauthed():
    return TestClient(main.app)


def test_speech_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post("/api/ai/speech", json={"topic": "x", "side": "aff"})
    assert r.status_code == 401


def test_response_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post(
        "/api/ai/response", json={"topic": "x", "first_speech": "y"}
    )
    assert r.status_code == 401


def test_judgment_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post(
        "/api/ai/judgment",
        json={"topic": "x", "aff_speech": "a", "neg_speech": "n", "aff_two_speech": "a2"},
    )
    assert r.status_code == 401


def test_aff_rebuttal_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post(
        "/api/ai/aff-rebuttal",
        json={"topic": "x", "aff_speech": "a", "neg_speech": "n"},
    )
    assert r.status_code == 401


def test_speech_route_happy_path(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.return_value = _chat_completion("a speech")
    r = client_authed.post("/api/ai/speech", json={"topic": "x", "side": "aff"})
    assert r.status_code == 200
    assert r.json() == {"speech": "a speech"}


def test_response_route_happy_path(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.return_value = _chat_completion("neg")
    r = client_authed.post(
        "/api/ai/response", json={"topic": "x", "first_speech": "y"}
    )
    assert r.status_code == 200
    assert r.json() == {"speech": "neg"}


def test_aff_rebuttal_route_happy_path(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.return_value = _chat_completion("aff rebuttal")
    r = client_authed.post(
        "/api/ai/aff-rebuttal",
        json={"topic": "x", "aff_speech": "a", "neg_speech": "n"},
    )
    assert r.status_code == 200
    assert r.json() == {"speech": "aff rebuttal"}


def test_response_stream_route(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.return_value = _AsyncStream(["Hello ", "world"])
    with client_authed.stream(
        "POST",
        "/api/ai/response-stream",
        json={"topic": "x", "first_speech": "y"},
    ) as r:
        assert r.status_code == 200
        body = b"".join(r.iter_bytes()).decode()
    assert "data: Hello \n\n" in body
    assert "data: world\n\n" in body
    assert body.rstrip().endswith("data: [DONE]")


def test_judgment_route_happy_path(
    client_authed: TestClient, patched_client: AsyncMock, monkeypatch: pytest.MonkeyPatch
):
    update_round = AsyncMock()
    monkeypatch.setattr(ai_route.rounds_service, "update_round", update_round)
    flow_payload = {
        "aff_sheet": [],
        "neg_sheet": [],
        "ballot": {"aff_unrefuted": 0, "neg_unrefuted": 0, "winner": "neg", "explanation": "tie"},
        "dropped": [],
        "voters": [],
        "recommended_drills": [],
    }
    patched_client.side_effect = [
        _chat_completion(json.dumps({"winner_side": "neg", "rfd": "neg wins"})),
        _chat_completion(json.dumps(flow_payload)),
    ]
    r = client_authed.post(
        "/api/ai/judgment",
        json={
            "round_id": "round-1",
            "topic": "x",
            "aff_speech": "a",
            "neg_speech": "n",
            "aff_two_speech": "a2",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["winner_side"] == "neg"
    assert data["rfd"] == "neg wins"
    assert data["flow"]["ballot"]["winner"] == "neg"
    update_round.assert_awaited_once()
    assert update_round.await_args.args[:2] == ("user-1", "round-1")
    assert update_round.await_args.args[2]["winner_side"] == "neg"


def test_judgment_route_reuses_cached_round_judgment(
    client_authed: TestClient, patched_client: AsyncMock, monkeypatch: pytest.MonkeyPatch
):
    flow_payload = {
        "aff_sheet": [],
        "neg_sheet": [],
        "ballot": {
            "aff_unrefuted": 0,
            "neg_unrefuted": 0,
            "winner": "aff",
            "explanation": "aff wins",
        },
        "dropped": [],
        "voters": [],
        "recommended_drills": [],
    }
    cached_round = SimpleNamespace(
        rfd="cached aff wins",
        winner_side="aff",
        flow=flow_payload,
    )
    get_round = AsyncMock(return_value=cached_round)
    update_round = AsyncMock()
    monkeypatch.setattr(ai_route.rounds_service, "get_round", get_round)
    monkeypatch.setattr(ai_route.rounds_service, "update_round", update_round)

    r = client_authed.post(
        "/api/ai/judgment",
        json={
            "round_id": "round-1",
            "topic": "x",
            "aff_speech": "a",
            "neg_speech": "n",
            "aff_two_speech": "a2",
        },
    )

    assert r.status_code == 200
    assert r.json()["rfd"] == "cached aff wins"
    assert r.json()["winner_side"] == "aff"
    patched_client.assert_not_awaited()
    update_round.assert_not_awaited()


def test_judgment_route_retries_save_without_winner_side(
    client_authed: TestClient, patched_client: AsyncMock, monkeypatch: pytest.MonkeyPatch
):
    update_round = AsyncMock(side_effect=[RuntimeError("winner_side missing"), None])
    monkeypatch.setattr(ai_route.rounds_service, "update_round", update_round)
    flow_payload = {
        "aff_sheet": [],
        "neg_sheet": [],
        "ballot": {
            "aff_unrefuted": 0,
            "neg_unrefuted": 0,
            "winner": "aff",
            "explanation": "aff wins",
        },
        "dropped": [],
        "voters": [],
        "recommended_drills": [],
    }
    patched_client.side_effect = [
        _chat_completion(json.dumps({"winner_side": "aff", "rfd": "aff wins"})),
        _chat_completion(json.dumps(flow_payload)),
    ]

    r = client_authed.post(
        "/api/ai/judgment",
        json={
            "round_id": "round-1",
            "topic": "x",
            "aff_speech": "a",
            "neg_speech": "n",
            "aff_two_speech": "a2",
        },
    )

    assert r.status_code == 200
    assert update_round.await_count == 2
    first_fields = update_round.await_args_list[0].args[2]
    second_fields = update_round.await_args_list[1].args[2]
    assert first_fields["winner_side"] == "aff"
    assert "winner_side" not in second_fields
    assert second_fields["rfd"] == "aff wins"


def test_judgment_route_malformed_flow_returns_502(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.side_effect = [
        _chat_completion(json.dumps({"winner_side": "aff", "rfd": "aff wins"})),
        _chat_completion("not json"),
    ]
    r = client_authed.post(
        "/api/ai/judgment",
        json={"topic": "x", "aff_speech": "a", "neg_speech": "n", "aff_two_speech": "a2"},
    )
    assert r.status_code == 502
