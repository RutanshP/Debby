"""Tests for the Supabase JWT auth dependency (JWKS / ES256)."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from jwt import PyJWKClientError

from deps import auth as auth_module
from deps.auth import User, get_current_user

AUD = "authenticated"


# Single ES256 keypair shared by all tests. The dep is patched to read the
# public key from `_FakeSigningKey` regardless of `kid`, so test tokens just
# need to be signed with the matching private key.
_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
_OTHER_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def _private_pem(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


_PUBLIC_PEM = _PRIVATE_KEY.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
)


class _FakeSigningKey:
    """Mimics the `.key` attribute PyJWKClient returns."""

    def __init__(self, pem: bytes) -> None:
        self.key = pem


def _make_token(
    *,
    sub: str = "user-123",
    email: str | None = "alice@example.com",
    private_key: ec.EllipticCurvePrivateKey | None = None,
    exp_delta: timedelta = timedelta(minutes=5),
    aud: str | None = AUD,
) -> str:
    key = _private_pem(private_key or _PRIVATE_KEY)
    now = datetime.now(tz=timezone.utc)
    claims: dict[str, Any] = {
        "sub": sub,
        "iat": int(now.timestamp()),
        "exp": int((now + exp_delta).timestamp()),
    }
    if email is not None:
        claims["email"] = email
    if aud is not None:
        claims["aud"] = aud
    return jwt.encode(claims, key, algorithm="ES256")


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bypass the real JWKS fetch; always return our test public key."""

    class _StubClient:
        def get_signing_key_from_jwt(self, _token: str) -> _FakeSigningKey:
            return _FakeSigningKey(_PUBLIC_PEM)

    monkeypatch.setattr(auth_module, "_jwks_client", _StubClient())
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")


# ---------------------------------------------------------------------------
# Happy path + claim validation
# ---------------------------------------------------------------------------


async def test_valid_token_returns_user() -> None:
    token = _make_token(sub="user-abc", email="bob@example.com")
    user = await get_current_user(authorization=f"Bearer {token}")
    assert isinstance(user, User)
    assert user.id == "user-abc"
    assert user.email == "bob@example.com"


async def test_token_without_email_returns_user_with_none_email() -> None:
    token = _make_token(sub="user-xyz", email=None)
    user = await get_current_user(authorization=f"Bearer {token}")
    assert user.id == "user-xyz"
    assert user.email is None


# ---------------------------------------------------------------------------
# Rejection paths
# ---------------------------------------------------------------------------


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
        await get_current_user(authorization=token)
    assert exc.value.status_code == 401


async def test_signature_mismatch_raises_401() -> None:
    token = _make_token(private_key=_OTHER_PRIVATE_KEY)
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
    """alg=none must be rejected — only ES256/RS256 are accepted."""

    def b64(d: dict[str, object]) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    header = b64({"alg": "none", "typ": "JWT"})
    payload = b64({"sub": "evil", "aud": AUD})
    token = f"{header}.{payload}."
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=f"Bearer {token}")
    assert exc.value.status_code == 401


async def test_jwks_fetch_failure_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """If JWKS can't be fetched or the kid is unknown, we 401 rather than 5xx."""

    class _BoomClient:
        def get_signing_key_from_jwt(self, _token: str) -> _FakeSigningKey:
            raise PyJWKClientError("network down")

    monkeypatch.setattr(auth_module, "_jwks_client", _BoomClient())
    token = _make_token()
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=f"Bearer {token}")
    assert exc.value.status_code == 401
