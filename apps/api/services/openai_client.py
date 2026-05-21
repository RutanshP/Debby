"""Shared async OpenAI client.

Instantiated ONCE at module import. Reads OPENAI_API_KEY from env via the
AsyncOpenAI constructor's default behavior. All AI helpers import `client`
from here so we never spin up new HTTP pools per call.
"""

from __future__ import annotations

from openai import AsyncOpenAI

client: AsyncOpenAI = AsyncOpenAI()

__all__ = ["client"]
