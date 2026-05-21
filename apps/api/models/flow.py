"""Pydantic models for the AI-generated flow ballot.

These mirror the structured output schema produced by `generate_round_flow`
and the normalization layer that legacy backend/app.py applied on top of the
raw model JSON. Field shapes were derived from backend/debby.py:194-310 and
backend/app.py:323-489.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Side = Literal["aff", "neg"]
RowStatus = Literal["unrefuted", "refuted", "contested"]


class FlowItem(BaseModel):
    """A single tagged argument node — used for contentions, responses, etc."""

    tag: str = Field(default="Untitled")
    summary: str = Field(default="Open transcripts for details.")
    refuted: bool | None = None

    model_config = {"extra": "ignore"}


class AffSheetRow(BaseModel):
    """One row on the affirmative flow sheet.

    Order: AFF contention -> NEG responses -> AFF defense.
    """

    contention: FlowItem
    neg_responses: list[FlowItem] = Field(default_factory=list)
    aff_defense: list[FlowItem] = Field(default_factory=list)
    status: RowStatus = "contested"
    judge_note: str = "No judge note generated."

    model_config = {"extra": "ignore"}


class NegSheetRow(BaseModel):
    """One row on the negation flow sheet.

    Order: NEG contention -> AFF rebuttals.
    """

    contention: FlowItem
    aff_rebuttals: list[FlowItem] = Field(default_factory=list)
    status: RowStatus = "contested"
    judge_note: str = "No judge note generated."

    model_config = {"extra": "ignore"}


class Ballot(BaseModel):
    aff_unrefuted: int = 0
    neg_unrefuted: int = 0
    winner: Side = "neg"
    explanation: str = ""

    model_config = {"extra": "ignore"}


class Voter(BaseModel):
    tag: str = "Winning contention / impact"
    winner: Side = "neg"
    reason: str = ""

    model_config = {"extra": "ignore"}


class FlowBallot(BaseModel):
    """Full structured flow returned by `generate_round_flow`."""

    aff_sheet: list[AffSheetRow] = Field(default_factory=list)
    neg_sheet: list[NegSheetRow] = Field(default_factory=list)
    ballot: Ballot = Field(default_factory=Ballot)
    dropped: list[FlowItem] = Field(default_factory=list)
    voters: list[Voter] = Field(default_factory=list)
    recommended_drills: list[str] = Field(default_factory=list)

    model_config = {"extra": "ignore"}


class WinnerVerdict(BaseModel):
    """Structured output for `winner`."""

    winner_side: Side
    rfd: str

    model_config = {"extra": "ignore"}
