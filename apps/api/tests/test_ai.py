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


async def test_ai_neg_framework_returns_string(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("neg framework speech")
    out = await ai_service.ai_neg_framework("AI in schools")
    assert out == "neg framework speech"
    patched_client.assert_awaited_once()


async def test_ai_neg_framework_prompt_omits_conclusion_language(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion("neg framework")
    await ai_service.ai_neg_framework("topic about tech")

    messages = patched_client.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    # Must include the opener instruction
    assert "Hello my name is Debby" in user_prompt
    # Must explicitly exclude a conclusion/summary paragraph
    assert "Do NOT include a conclusion" in user_prompt or "no conclusion" in user_prompt.lower() or "no concluding" in user_prompt.lower() or "no closing" in user_prompt.lower() or "no summary" in user_prompt.lower() or "NOT include a conclusion" in user_prompt


async def test_ai_neg_framework_prompt_no_concluding_summary(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion("neg framework")
    await ai_service.ai_neg_framework("climate change")

    messages = patched_client.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    # The prompt must explicitly forbid a conclusion / closing / summary sentence
    conclusion_guards = [
        "Do NOT include a conclusion",
        "closing/wrap-up",
        "no closing",
        "no summary",
    ]
    assert any(g.lower() in user_prompt.lower() for g in conclusion_guards)


async def test_ai_neg_rebuttal_returns_string(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("neg rebuttal paragraph")
    out = await ai_service.ai_neg_rebuttal("topic", "neg case", "aff speech")
    assert out == "neg rebuttal paragraph"
    patched_client.assert_awaited_once()


async def test_ai_neg_rebuttal_prompt_includes_case_and_aff_speech(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion("neg rebuttal")
    await ai_service.ai_neg_rebuttal("debate topic", "my neg case text", "aff speech text")

    messages = patched_client.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    # Must include both the neg case and aff speech
    assert "my neg case text" in user_prompt
    assert "aff speech text" in user_prompt
    # Must have "only" or do-not-restate guards
    assert any(
        guard in user_prompt
        for guard in [
            "ONLY",
            "only",
            "Do NOT restate",
            "do not restate",
        ]
    )


async def test_ai_neg_rebuttal_raises_on_empty_inputs(patched_client: AsyncMock):
    with pytest.raises(ValueError):
        await ai_service.ai_neg_rebuttal("", "case", "aff")
    with pytest.raises(ValueError):
        await ai_service.ai_neg_rebuttal("topic", "", "aff")
    with pytest.raises(ValueError):
        await ai_service.ai_neg_rebuttal("topic", "case", "")


async def test_ai_neg_rebuttal_max_tokens_is_350(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("rebuttal")
    await ai_service.ai_neg_rebuttal("topic", "case", "aff speech")
    assert patched_client.await_args.kwargs["max_tokens"] == 350


async def test_ai_aff_overview_returns_string(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("aff overview paragraph")
    out = await ai_service.ai_aff_overview("topic", "aff speech")
    assert out == "aff overview paragraph"
    patched_client.assert_awaited_once()


async def test_ai_aff_overview_prompt_uses_topic_and_aff_only(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion("overview")
    await ai_service.ai_aff_overview("debate topic", "the aff speech text")

    messages = patched_client.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    # Must include topic and aff speech
    assert "debate topic" in user_prompt
    assert "the aff speech text" in user_prompt
    # Must not include neg speech (no neg speech param)
    assert "neg" not in user_prompt.lower() or "no rebuttal" in user_prompt.lower() or "Do not make any rebuttal" in user_prompt


async def test_ai_aff_overview_no_rebuttal_in_prompt(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("overview")
    await ai_service.ai_aff_overview("topic", "aff speech")

    messages = patched_client.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    assert "Do not make any rebuttal" in user_prompt or "no rebuttal" in user_prompt.lower()


async def test_ai_aff_overview_raises_on_empty_inputs(patched_client: AsyncMock):
    with pytest.raises(ValueError):
        await ai_service.ai_aff_overview("", "aff speech")
    with pytest.raises(ValueError):
        await ai_service.ai_aff_overview("topic", "")


async def test_ai_aff_overview_max_tokens_is_250(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("overview")
    await ai_service.ai_aff_overview("topic", "aff speech")
    assert patched_client.await_args.kwargs["max_tokens"] == 250


async def test_ai_aff_rebuttal_returns_append_only_paragraph(
    patched_client: AsyncMock,
):
    patched_client.return_value = _chat_completion("aff rebuttal")
    out = await ai_service.ai_aff_rebuttal("topic", "aff speech", "neg speech")
    assert out == "aff rebuttal"

    messages = patched_client.await_args.kwargs["messages"]
    system_prompt = messages[0]["content"]
    user_prompt = messages[1]["content"]
    # Must instruct no overview, no new case, no greeting
    assert "Do not introduce a new constructive case" in system_prompt
    assert "Do not include a greeting" in system_prompt or "greeting" in system_prompt
    assert "Do not include an overview" in system_prompt or "overview" in user_prompt
    # Must be append-only / single paragraph
    assert "single paragraph" in user_prompt or "ONLY" in user_prompt or "only" in user_prompt


async def test_ai_aff_rebuttal_prompt_uses_neg_speech(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("aff rebuttal")
    await ai_service.ai_aff_rebuttal("topic", "my aff speech", "my neg speech")

    messages = patched_client.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    assert "my neg speech" in user_prompt
    assert "my aff speech" in user_prompt


async def test_ai_aff_rebuttal_max_tokens_is_350(patched_client: AsyncMock):
    patched_client.return_value = _chat_completion("aff rebuttal")
    await ai_service.ai_aff_rebuttal("topic", "aff speech", "neg speech")
    assert patched_client.await_args.kwargs["max_tokens"] == 350


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


async def test_winner_prompt_keeps_rfd_short_and_separate_from_flow(
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
    assert "under 90 words" in system_prompt
    assert "Merely repeating" in system_prompt
    assert "Do not infer, repair, or invent" in system_prompt
    assert "not in the RFD" in user_prompt


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


def test_neg_framework_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post("/api/ai/neg-framework", json={"topic": "x"})
    assert r.status_code == 401


def test_neg_rebuttal_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post(
        "/api/ai/neg-rebuttal",
        json={"topic": "x", "neg_case": "c", "aff_speech": "a"},
    )
    assert r.status_code == 401


def test_aff_overview_route_requires_auth(client_unauthed: TestClient):
    r = client_unauthed.post(
        "/api/ai/aff-overview",
        json={"topic": "x", "aff_speech": "a"},
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


def test_neg_framework_route_happy_path(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.return_value = _chat_completion("neg framework")
    r = client_authed.post("/api/ai/neg-framework", json={"topic": "x"})
    assert r.status_code == 200
    assert r.json() == {"speech": "neg framework"}


def test_neg_rebuttal_route_happy_path(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.return_value = _chat_completion("neg rebuttal paragraph")
    r = client_authed.post(
        "/api/ai/neg-rebuttal",
        json={"topic": "x", "neg_case": "c", "aff_speech": "a"},
    )
    assert r.status_code == 200
    assert r.json() == {"speech": "neg rebuttal paragraph"}


def test_aff_overview_route_happy_path(
    client_authed: TestClient, patched_client: AsyncMock
):
    patched_client.return_value = _chat_completion("aff overview")
    r = client_authed.post(
        "/api/ai/aff-overview",
        json={"topic": "x", "aff_speech": "a"},
    )
    assert r.status_code == 200
    assert r.json() == {"speech": "aff overview"}


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
