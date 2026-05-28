"""Shared async OpenAI client.

Constructed lazily on first use so the API can boot and serve health checks
even if deployment secrets are still being configured.
"""

from __future__ import annotations

from typing import Any

from openai import AsyncOpenAI


class _LazyAsyncOpenAI:
    _client: AsyncOpenAI | None = None

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI()
        return self._client

    def __getattr__(self, name: str) -> Any:
        return getattr(self._get_client(), name)


client = _LazyAsyncOpenAI()

__all__ = ["client"]
