"""Tests for topics service + route."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from services.topics import coin_toss, get_mspdp_topic, get_parli_topic


client = TestClient(app)


def test_get_parli_topic_with_known_tournament() -> None:
    # "Bargain Belt" appears in the legacy CSV as "Bargain Belt 2023-24",
    # which the service normalizes by stripping the year suffix.
    topic = get_parli_topic("Bargain Belt")
    assert isinstance(topic, str)
    assert topic.strip() != ""


def test_get_parli_topic_with_none() -> None:
    topic = get_parli_topic(None)
    assert isinstance(topic, str)
    assert topic.strip() != ""


def test_get_parli_topic_unknown_tournament_falls_back() -> None:
    topic = get_parli_topic("__definitely_not_a_tournament__")
    assert isinstance(topic, str)
    assert topic.strip() != ""


def test_get_mspdp_topic() -> None:
    topic = get_mspdp_topic()
    assert isinstance(topic, str)
    assert topic.strip() != ""


def test_coin_toss_distribution() -> None:
    seen = {coin_toss() for _ in range(200)}
    assert seen.issubset({"aff", "neg"})
    # With 200 trials, both outcomes should appear with overwhelming probability.
    assert seen == {"aff", "neg"}


def test_route_parli_happy_path() -> None:
    resp = client.get("/api/topics", params={"format": "parli"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["format"] == "parli"
    assert isinstance(body["topic"], str) and body["topic"].strip() != ""
    assert body["side"] in {"aff", "neg"}


def test_route_parli_with_tournament() -> None:
    resp = client.get(
        "/api/topics",
        params={"format": "parli", "tournament": "Bargain Belt"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["format"] == "parli"
    assert body["topic"].strip() != ""


def test_route_mspdp_happy_path() -> None:
    resp = client.get("/api/topics", params={"format": "mspdp"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["format"] == "mspdp"
    assert isinstance(body["topic"], str) and body["topic"].strip() != ""
    assert body["side"] in {"aff", "neg"}


def test_route_invalid_format_returns_400() -> None:
    resp = client.get("/api/topics", params={"format": "lincoln-douglas"})
    assert resp.status_code == 400
