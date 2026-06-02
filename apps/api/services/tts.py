"""Deepgram Aura-2 text-to-speech service."""

from __future__ import annotations

import asyncio
import os
import re
from collections.abc import AsyncIterator

import httpx

DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak"
DEFAULT_VOICE = "aura-2-thalia-en"
MAX_CHARS = 2000
MAX_RETRIES = 3
RETRY_BASE_DELAY_SECONDS = 0.75
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MARKDOWN_MARKERS = re.compile(r"[*_`#>~]")


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


def _clean_tts_text(text: str) -> str:
    cleaned = _MARKDOWN_LINK.sub(r"\1", text)
    cleaned = _MARKDOWN_MARKERS.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


async def _post_tts_with_retry(
    client: httpx.AsyncClient,
    *,
    headers: dict[str, str],
    voice: str,
    chunk: str,
) -> bytes:
    delay = RETRY_BASE_DELAY_SECONDS
    last_error: str | None = None

    for attempt in range(MAX_RETRIES + 1):
        response = await client.post(
            DEEPGRAM_SPEAK_URL,
            params={"model": voice},
            headers=headers,
            json={"text": chunk},
        )
        if response.status_code < 400:
            return response.content

        last_error = f"Deepgram TTS failed: {response.status_code} {response.text}"
        if response.status_code == 429 and attempt < MAX_RETRIES:
            await asyncio.sleep(delay)
            delay *= 2
            continue
        raise TTSError(last_error)

    raise TTSError(last_error or "Deepgram TTS failed")


async def synthesize(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    key = _api_key()
    headers = {"Authorization": f"Token {key}"}
    chunks = _chunk(_clean_tts_text(text))

    async def synthesize_chunk(client: httpx.AsyncClient, chunk: str) -> bytes:
        return await _post_tts_with_retry(
            client,
            headers=headers,
            voice=voice,
            chunk=chunk,
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        segments = await asyncio.gather(
            *(synthesize_chunk(client, chunk) for chunk in chunks)
        )

    return b"".join(segments)


async def stream_synthesize(
    text: str, voice: str = DEFAULT_VOICE
) -> AsyncIterator[bytes]:
    key = _api_key()
    headers = {"Authorization": f"Token {key}"}
    chunks = _chunk(_clean_tts_text(text))

    async with httpx.AsyncClient(timeout=30.0) as client:
        for chunk in chunks:
            yield await _post_tts_with_retry(
                client,
                headers=headers,
                voice=voice,
                chunk=chunk,
            )
