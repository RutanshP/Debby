"""AI endpoints — speech, response (with streaming variant), and judgment.

Auth is enforced via `deps.auth.get_current_user`, which is provided by unit
A1. Until A1 lands we depend on the contract:

  - `User` is a Pydantic model with `id: str` and `email: str | None`.
  - `get_current_user` raises 401 on missing/invalid bearer token.

If A1 hasn't merged we install a fallback dependency that always returns 401,
which matches the contract closely enough for boot checks and unit tests
(those override the dep anyway).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from openai import APIStatusError, RateLimitError
from pydantic import BaseModel, Field

from models.flow import FlowBallot, WinnerVerdict
from services import ai as ai_service

try:  # pragma: no cover — import-time fallback
    from deps.auth import User, get_current_user  # type: ignore
except Exception:  # A1 not merged yet
    class User(BaseModel):  # type: ignore[no-redef]
        id: str
        email: str | None = None

    async def get_current_user() -> User:  # type: ignore[no-redef]
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )


router = APIRouter(prefix="/ai", tags=["ai"])


Side = Literal["aff", "neg"]


# --- request / response models ------------------------------------------------


class SpeechBody(BaseModel):
    topic: str = Field(..., min_length=1)
    side: Side = "aff"


class SpeechResponse(BaseModel):
    speech: str


class ResponseBody(BaseModel):
    topic: str = Field(..., min_length=1)
    first_speech: str = Field(..., min_length=1)


class JudgmentBody(BaseModel):
    topic: str = Field(..., min_length=1)
    aff_speech: str = Field(..., min_length=1)
    neg_speech: str = Field(..., min_length=1)
    aff_two_speech: str = Field(..., min_length=1)


class JudgmentResponse(BaseModel):
    rfd: str
    winner_side: Side
    flow: FlowBallot


# --- error translation --------------------------------------------------------


def _translate_openai_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RateLimitError):
        return HTTPException(status_code=429, detail="OpenAI rate limit")
    if isinstance(exc, APIStatusError):
        return HTTPException(
            status_code=exc.status_code or 502,
            detail=f"OpenAI error: {exc.message if hasattr(exc, 'message') else str(exc)}",
        )
    if isinstance(exc, ValueError):
        return HTTPException(status_code=502, detail=f"Bad model output: {exc}")
    return HTTPException(status_code=500, detail="Internal AI error")


# --- routes -------------------------------------------------------------------


@router.post("/speech", response_model=SpeechResponse)
async def post_speech(
    body: SpeechBody,
    user: User = Depends(get_current_user),
) -> SpeechResponse:
    try:
        text = await ai_service.ai_speech(body.topic, body.side)
    except (RateLimitError, APIStatusError, ValueError) as exc:
        raise _translate_openai_error(exc) from exc
    return SpeechResponse(speech=text)


@router.post("/response", response_model=SpeechResponse)
async def post_response(
    body: ResponseBody,
    user: User = Depends(get_current_user),
) -> SpeechResponse:
    try:
        text = await ai_service.ai_response(body.topic, body.first_speech)
    except (RateLimitError, APIStatusError, ValueError) as exc:
        raise _translate_openai_error(exc) from exc
    return SpeechResponse(speech=text)


@router.post("/response-stream")
async def post_response_stream(
    body: ResponseBody,
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    async def event_source():
        try:
            async for token in ai_service.ai_response_stream(
                body.topic, body.first_speech
            ):
                # SSE: each chunk is `data: <token>\n\n`. Escape newlines so a
                # multi-line token doesn't accidentally split into events.
                safe = token.replace("\r", "").replace("\n", "\\n")
                yield f"data: {safe}\n\n"
        except RateLimitError:
            yield "event: error\ndata: rate_limit\n\n"
        except APIStatusError as exc:
            yield f"event: error\ndata: {exc.status_code or 'api_error'}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_source(), media_type="text/event-stream")


@router.post("/judgment", response_model=JudgmentResponse)
async def post_judgment(
    body: JudgmentBody,
    user: User = Depends(get_current_user),
) -> JudgmentResponse:
    try:
        verdict: WinnerVerdict = await ai_service.winner(
            body.aff_speech,
            body.neg_speech,
            body.aff_two_speech,
            body.topic,
        )
        flow = await ai_service.generate_round_flow(
            body.topic,
            body.aff_speech,
            body.neg_speech,
            body.aff_two_speech,
            verdict.rfd,
        )
    except (RateLimitError, APIStatusError, ValueError) as exc:
        raise _translate_openai_error(exc) from exc

    return JudgmentResponse(
        rfd=verdict.rfd,
        winner_side=verdict.winner_side,
        flow=flow,
    )
