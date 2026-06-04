"""Shared mapping from service-layer exceptions to HTTP responses.

Service functions raise plain Python exceptions; routes translate them into
the matching HTTP status so the mapping stays consistent across every router.
"""

from __future__ import annotations

from fastapi import HTTPException


def translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))
