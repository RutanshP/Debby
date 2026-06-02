"""Deepgram Aura-2 text-to-speech service."""

from __future__ import annotations

import asyncio
import os
import re

import httpx

DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak"
DEFAULT_VOICE = "aura-2-thalia-en"
MAX_CHARS = 2000
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


class TTSError(RuntimeError):
    """Raised when Deepgram returns an error or is misconfigured."""


def _api_key() -> str:
    key = os.environ.get("DEEPGRAM_KEY")
    if not key:
        raise TTSError("DEEPGRAM_KEY is not configured")
    return key


def _chunk(text: str) -> list[str]:
    if len(text) <= MAX_CHARS:
        return [text]

    sentences = _SENTENCE_END.split(text)
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if len(sentence) > MAX_CHARS:
            if current:
                chunks.append(current.strip())
                current = ""
            words = sentence.split()
            for word in words:
                while len(word) > MAX_CHARS:
                    if current:
                        chunks.append(current.strip())
                        current = ""
                    chunks.append(word[:MAX_CHARS])
                    word = word[MAX_CHARS:]
                if not word:
                    continue
                if current and len(current) + 1 + len(word) > MAX_CHARS:
                    chunks.append(current.strip())
                    current = word
                else:
                    current = (current + " " + word).lstrip() if current else word
            continue

        candidate = (current + " " + sentence).lstrip() if current else sentence
        if len(candidate) <= MAX_CHARS:
            current = candidate
        else:
            if current:
                chunks.append(current.strip())
            current = sentence

    if current:
        chunks.append(current.strip())

    return [chunk for chunk in chunks if chunk]


async def synthesize(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    key = _api_key()
    headers = {"Authorization": f"Token {key}"}
    chunks = _chunk(text)

    async def synthesize_chunk(client: httpx.AsyncClient, chunk: str) -> bytes:
        response = await client.post(
            DEEPGRAM_SPEAK_URL,
            params={"model": voice},
            headers=headers,
            json={"text": chunk},
        )
        if response.status_code >= 400:
            raise TTSError(
                f"Deepgram TTS failed: {response.status_code} {response.text}"
            )
        return response.content

    async with httpx.AsyncClient(timeout=30.0) as client:
        segments = await asyncio.gather(
            *(synthesize_chunk(client, chunk) for chunk in chunks)
        )

    return b"".join(segments)
