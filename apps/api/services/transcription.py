"""Async AssemblyAI transcription.

Bypasses ffmpeg/pydub entirely: AssemblyAI's upload endpoint accepts raw
webm/opus bytes, so we just stream them up and poll for the transcript.
"""

from __future__ import annotations

import asyncio
import os

import httpx

from models.round import TranscriptionResult, Word

ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"
_UPLOAD_URL = f"{ASSEMBLYAI_BASE_URL}/upload"
_TRANSCRIPT_URL = f"{ASSEMBLYAI_BASE_URL}/transcript"
_STREAMING_TOKEN_URL = "https://streaming.assemblyai.com/v3/token"

# Polling configuration. Start at 1s; exponential backoff capped at 5s.
_POLL_INITIAL_DELAY = 1.0
_POLL_MAX_DELAY = 5.0
_POLL_TIMEOUT_SECONDS = 300.0


class TranscriptionError(RuntimeError):
    """Raised when AssemblyAI returns an error or fails."""


def _api_key() -> str:
    key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not key:
        raise TranscriptionError("ASSEMBLYAI_API_KEY is not configured")
    return key


async def transcribe(
    audio_bytes: bytes, include_words: bool = False
) -> TranscriptionResult:
    """Upload audio bytes to AssemblyAI and return the transcript.

    ``audio_bytes`` may be webm/opus, wav, or any other format AssemblyAI
    accepts — no client-side conversion is performed.
    """

    if not audio_bytes:
        raise TranscriptionError("Audio payload is empty")

    headers = {"authorization": _api_key()}

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1) Upload raw bytes.
        upload_resp = await client.post(
            _UPLOAD_URL,
            content=audio_bytes,
            headers={**headers, "content-type": "application/octet-stream"},
        )
        if upload_resp.status_code >= 400:
            raise TranscriptionError(
                f"AssemblyAI upload failed: {upload_resp.status_code} {upload_resp.text}"
            )
        upload_url = upload_resp.json().get("upload_url")
        if not upload_url:
            raise TranscriptionError("AssemblyAI upload did not return upload_url")

        # 2) Request transcription.
        create_resp = await client.post(
            _TRANSCRIPT_URL,
            json={"audio_url": upload_url, "speech_models": ["universal-2"]},
            headers=headers,
        )
        if create_resp.status_code >= 400:
            raise TranscriptionError(
                f"AssemblyAI transcript create failed: {create_resp.status_code} {create_resp.text}"
            )
        transcript_id = create_resp.json().get("id")
        if not transcript_id:
            raise TranscriptionError("AssemblyAI did not return transcript id")

        # 3) Poll until done.
        poll_url = f"{_TRANSCRIPT_URL}/{transcript_id}"
        delay = _POLL_INITIAL_DELAY
        elapsed = 0.0
        while True:
            poll_resp = await client.get(poll_url, headers=headers)
            if poll_resp.status_code >= 400:
                raise TranscriptionError(
                    f"AssemblyAI poll failed: {poll_resp.status_code} {poll_resp.text}"
                )
            payload = poll_resp.json()
            status = payload.get("status")

            if status == "completed":
                return _build_result(payload, include_words)
            if status == "error":
                raise TranscriptionError(
                    f"AssemblyAI transcription error: {payload.get('error') or 'unknown error'}"
                )

            if elapsed >= _POLL_TIMEOUT_SECONDS:
                raise TranscriptionError("AssemblyAI transcription timed out")

            await asyncio.sleep(delay)
            elapsed += delay
            delay = min(delay * 1.5, _POLL_MAX_DELAY)


def _build_result(payload: dict, include_words: bool) -> TranscriptionResult:
    text = payload.get("text") or ""
    # audio_duration is in seconds when present.
    raw_duration = payload.get("audio_duration") or 0
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError):
        duration = 0.0

    words_payload = payload.get("words") or []
    if duration <= 0 and words_payload:
        # Fall back to the last word's end timestamp (ms).
        last_end_ms = max((w.get("end") or 0) for w in words_payload)
        duration = last_end_ms / 1000.0

    words: list[Word] | None = None
    if include_words:
        words = [
            Word(
                text=w.get("text") or "",
                start=int(w.get("start") or 0),
                end=int(w.get("end") or 0),
            )
            for w in words_payload
        ]

    return TranscriptionResult(
        text=text,
        audio_duration_seconds=duration,
        words=words,
    )


async def create_streaming_token(
    expires_in_seconds: int = 60,
    max_session_duration_seconds: int = 600,
) -> dict:
    """Create a short-lived AssemblyAI Universal-Streaming token."""

    headers = {"authorization": _api_key()}
    params = {
        "expires_in_seconds": max(1, min(expires_in_seconds, 600)),
        "max_session_duration_seconds": max(
            60, min(max_session_duration_seconds, 10800)
        ),
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            _STREAMING_TOKEN_URL,
            headers=headers,
            params=params,
        )
    if response.status_code >= 400:
        raise TranscriptionError(
            f"AssemblyAI streaming token failed: {response.status_code} {response.text}"
        )
    token = response.json().get("token")
    if not token:
        raise TranscriptionError("AssemblyAI streaming token response was empty")
    return {
        "token": token,
        "expires_in_seconds": response.json().get("expires_in_seconds")
        or params["expires_in_seconds"],
    }
