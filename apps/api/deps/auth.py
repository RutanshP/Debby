"""Auth dependency: verifies Supabase JWTs against the project's JWKS.

Supabase deprecated symmetric HS256 + a shared JWT secret in late 2025;
user-session tokens are now signed with ES256/RS256 and verified via the
project's public JWKS endpoint (`/auth/v1/.well-known/jwks.json`).

The dependency exposes the same `User` shape it always did so the other
backend units don't need to change.
"""

from __future__ import annotations

import os

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient
from pydantic import BaseModel

_ALGORITHMS = ["ES256", "RS256"]
_AUDIENCE = "authenticated"

# PyJWKClient caches the JWKS in-process and refetches automatically on
# kid miss, so a single module-level instance is fine. The URL is taken
# from SUPABASE_URL at first use to keep import side-effect-free.
_jwks_client: PyJWKClient | None = None


class User(BaseModel):
    """Authenticated user, as decoded from a Supabase JWT."""

    id: str
    email: str | None = None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = os.environ.get("SUPABASE_URL")
        if not url:
            raise _unauthorized("Server auth not configured")
        _jwks_client = PyJWKClient(
            f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            lifespan=3600,
        )
    return _jwks_client


async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> User:
    """Verify the Bearer token against Supabase's JWKS; return the User.

    Raises 401 on any failure: missing/malformed header, expired token,
    signature mismatch, unknown signing key, or malformed JWT.
    """
    if not authorization:
        raise _unauthorized("Missing Authorization header")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("Invalid Authorization scheme; expected Bearer")

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=_ALGORITHMS,
            audience=_AUDIENCE,
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("Token expired") from exc
    except jwt.InvalidAudienceError as exc:
        raise _unauthorized("Invalid audience") from exc
    except jwt.PyJWKClientError as exc:
        # Unknown kid, JWKS fetch failure, malformed kid, etc.
        raise _unauthorized("Invalid token signing key") from exc
    except jwt.PyJWTError as exc:
        raise _unauthorized("Invalid token") from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise _unauthorized("Token missing subject")

    email = payload.get("email")
    if email is not None and not isinstance(email, str):
        email = None

    return User(id=user_id, email=email)
