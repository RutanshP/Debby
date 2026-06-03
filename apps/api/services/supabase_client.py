"""Lazy, thread-safe Supabase secret-key client.

Uses the new `sb_secret_…` key (formerly the service_role JWT). Module-level
instantiation is hidden behind ``get_supabase()`` so tests can monkeypatch
the getter without importing the real SDK.

Concurrency note: the underlying ``supabase`` sync client wraps a single
``httpx`` connection that is **not** safe to share across threads. The service
layer runs every query inside ``asyncio.to_thread``, so multiple worker threads
would otherwise hammer one shared socket and intermittently raise
``ReadError('[Errno 35] Resource temporarily unavailable')`` (EAGAIN) under
concurrent load. To avoid that, ``get_supabase()`` returns a lightweight proxy
that resolves a *per-thread* real client at call time. Because the services
call ``.table(...)`` (etc.) inside the worker thread, each thread gets its own
client and connection, eliminating the cross-thread sharing without requiring
any change to the call sites.
"""

from __future__ import annotations

import os
import threading
from typing import Any

_proxy: "_ThreadLocalSupabase | None" = None
_lock = threading.Lock()


def _create_real_client() -> Any:
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

    return create_client(url, key)


class _ThreadLocalSupabase:
    """Proxy that dispatches attribute access to a per-thread real client.

    Attribute access (``.table``, ``.auth``, ``.rpc``, …) is resolved against a
    client stored in thread-local storage and created on first use by the
    current thread. The service layer fetches this proxy on the event-loop
    thread but invokes its methods inside ``asyncio.to_thread`` workers, so each
    worker thread transparently uses its own client and connection.
    """

    def __init__(self) -> None:
        self._local = threading.local()

    def _real(self) -> Any:
        client = getattr(self._local, "client", None)
        if client is None:
            client = _create_real_client()
            self._local.client = client
        return client

    def __getattr__(self, name: str) -> Any:
        # __getattr__ only fires for names not found on the proxy itself, so
        # everything except the internal _local attribute routes to the real
        # per-thread client.
        return getattr(self._real(), name)


def get_supabase() -> Any:
    """Return a cached, thread-safe Supabase client built with the secret key.

    Raises ``RuntimeError`` if the env vars are missing.
    """

    global _proxy
    if _proxy is None:
        with _lock:
            if _proxy is None:
                # Validate configuration eagerly so a missing env var fails
                # fast on the first call rather than deep inside a worker.
                _create_real_client()
                _proxy = _ThreadLocalSupabase()
    return _proxy
