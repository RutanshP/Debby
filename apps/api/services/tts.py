"""Deepgram Aura-2 text-to-speech service.

Converts text to MP3 audio bytes via the Deepgram Speak API.  Long texts are
automatically split on sentence boundaries to stay within Deepgram's 2000-char
limit per request; the returned MP3 segments are concatenated in order (MP3
frames concatenate cleanly for sequential playback).
"""

from __future__ import annotations

import os
import re

import httpx

DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak"
DEFAULT_VOICE = "aura-2-thalia-en"
MAX_CHARS = 2000

# Sentence-ending punctuation used for chunking.
_SENTENCE_END = re.compile(r'(?<=[.!?])\s+')


class TTSError(RuntimeError):
    """Raised when Deepgram returns an error or is misconfigured."""


def _api_key() -> str:
    key = os.environ.get("DEEPGRAM_KEY")
    if not key:
        raise TTSError("DEEPGRAM_KEY is not configured")
    return key


def _chunk(text: str) -> list[str]:
    """Split *text* into pieces of at most MAX_CHARS characters.

    Splits are made on sentence boundaries (after ``.``, ``!``, ``?``)
    wherever possible.  If a single sentence is still too long it is split on
    word boundaries.  Empty chunks are never emitted.
    """
    if len(text) <= MAX_CHARS:
        return [text]

    # Split into sentences, keeping the trailing punctuation attached.
    sentences = _SENTENCE_END.split(text)

    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        # A sentence that is itself too long must be word-split.
        if len(sentence) > MAX_CHARS:
            # Flush whatever we have so far.
            if current:
                chunks.append(current.strip())
                current = ""
            # Word-split the oversized sentence.
            words = sentence.split()
            for word in words:
                # Hard-split a single word that itself exceeds MAX_CHARS.
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

        # Normal sentence: does it still fit in the current chunk?
        candidate = (current + " " + sentence).lstrip() if current else sentence
        if len(candidate) <= MAX_CHARS:
            current = candidate
        else:
            if current:
                chunks.append(current.strip())
            current = sentence

    if current:
        chunks.append(current.strip())

    # Filter out any accidentally empty strings.
    return [c for c in chunks if c]


async def synthesize(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Convert *text* to MP3 bytes using Deepgram's Aura-2 model.

    Splits the text into chunks as needed and concatenates the results.
    Raises :class:`TTSError` if the API key is missing or Deepgram returns
    an HTTP error.
    """
    key = _api_key()
    headers = {"Authorization": f"Token {key}"}
    segments: list[bytes] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for chunk in _chunk(text):
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
            segments.append(response.content)

    return b"".join(segments)
