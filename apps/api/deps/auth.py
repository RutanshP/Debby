"""Auth dependency: verifies Supabase JWTs and yields a `User` model.

Used by every protected FastAPI route. The contract (`User` shape and
`get_current_user` signature) is depended on by other backend units.
"""

from __future__ import annotations

import os

from fastapi import Header, HTTPException, status
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError
from pydantic import BaseModel

_ALGORITHM = "HS256"
_AUDIENCE = "authenticated"


class User(BaseModel):
    """Authenticated user, as decoded from a Supabase JWT."""

    id: str
    email: str | None = None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> User:
    """Decode + verify the Bearer token; return the authenticated `User`.

    Raises 401 on any failure: missing/malformed header, expired token,
    signature mismatch, or malformed JWT.
    """
    if not authorization:
        raise _unauthorized("Missing Authorization header")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("Invalid Authorization scheme; expected Bearer")

    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        # Misconfiguration — surface as 401 so we never accept unverified tokens.
        raise _unauthorized("Server auth not configured")

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[_ALGORITHM],
            audience=_AUDIENCE,
        )
    except ExpiredSignatureError as exc:
        raise _unauthorized("Token expired") from exc
    except JWTError as exc:
        raise _unauthorized("Invalid token") from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise _unauthorized("Token missing subject")

    email = payload.get("email")
    if email is not None and not isinstance(email, str):
        email = None

    return User(id=user_id, email=email)
