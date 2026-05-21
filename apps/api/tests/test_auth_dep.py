"""Tests for the Supabase JWT auth dependency."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jose import jwt

from deps.auth import User, get_current_user

SECRET = "test-secret-do-not-use-in-prod"
ALGO = "HS256"
AUD = "authenticated"


def _make_token(
    *,
    sub: str = "user-123",
    email: str | None = "alice@example.com",
    secret: str = SECRET,
    exp_delta: timedelta = timedelta(minutes=5),
    aud: str | None = AUD,
) -> str:
    now = datetime.now(tz=timezone.utc)
    claims: dict[str, object] = {
        "sub": sub,
        "iat": int(now.timestamp()),
        "exp": int((now + exp_delta).timestamp()),
    }
    if email is not None:
        claims["email"] = email
    if aud is not None:
        claims["aud"] = aud
    return jwt.encode(claims, secret, algorithm=ALGO)


@pytest.fixture(autouse=True)
def _set_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)


async def test_valid_token_returns_user() -> None:
    token = _make_token(sub="user-abc", email="bob@example.com")
    user = await get_current_user(authorization=f"Bearer {token}")
    assert isinstance(user, User)
    assert user.id == "user-abc"
    assert user.email == "bob@example.com"


async def test_expired_token_raises_401() -> None:
    token = _make_token(exp_delta=timedelta(minutes=-1))
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=f"Bearer {token}")
    assert exc.value.status_code == 401


async def test_missing_header_raises_401() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=None)
    assert exc.value.status_code == 401


async def test_missing_bearer_prefix_raises_401() -> None:
    token = _make_token()
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=token)  # no "Bearer " prefix
    assert exc.value.status_code == 401


async def test_signature_mismatch_raises_401() -> None:
    token = _make_token(secret="some-other-secret")
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=f"Bearer {token}")
    assert exc.value.status_code == 401


async def test_malformed_jwt_raises_401() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization="Bearer not-a-jwt")
    assert exc.value.status_code == 401


async def test_audience_mismatch_raises_401() -> None:
    token = _make_token(aud="someone-else")
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=f"Bearer {token}")
    assert exc.value.status_code == 401


async def test_none_alg_rejected() -> None:
    # Hand-craft a token with alg=none; must be rejected since we only allow HS256.
    import base64
    import json

    def b64(d: dict[str, object]) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    header = b64({"alg": "none", "typ": "JWT"})
    payload = b64({"sub": "evil", "aud": AUD})
    token = f"{header}.{payload}."
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=f"Bearer {token}")
    assert exc.value.status_code == 401
