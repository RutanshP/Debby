"""Lazy shared Supabase secret-key client.

Uses the new `sb_secret_…` key (formerly the service_role JWT). Module-level
instantiation is hidden behind ``get_supabase()`` so tests can monkeypatch
the getter without importing the real SDK.
"""

from __future__ import annotations

import os
from typing import Any

_client: Any | None = None


def get_supabase() -> Any:
    """Return a cached Supabase client built with the secret key.

    Raises ``RuntimeError`` if the env vars are missing.
    """

    global _client
    if _client is not None:
        return _client

    url = os.environ.get("SUPABASE_URL")
    # `sb_secret_…` is the modern replacement for the legacy service_role
    # JWT key. Fall back to the legacy env name for backwards compat during
    # the migration window.
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")

    # Imported lazily so tests that monkeypatch this module never need the
    # real `supabase` SDK installed at import time.
    from supabase import create_client  # type: ignore

    _client = create_client(url, key)
    return _client
