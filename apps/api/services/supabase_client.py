"""Lazy shared Supabase service-role client.

Module-level instantiation is hidden behind ``get_supabase()`` so tests can
monkeypatch the getter without importing the real SDK.
"""

from __future__ import annotations

import os
from typing import Any

_client: Any | None = None


def get_supabase() -> Any:
    """Return a cached Supabase client built with the service role key.

    Raises ``RuntimeError`` if the env vars are missing.
    """

    global _client
    if _client is not None:
        return _client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
        )

    # Imported lazily so tests that monkeypatch this module never need the
    # real `supabase` SDK installed at import time.
    from supabase import create_client  # type: ignore

    _client = create_client(url, key)
    return _client
