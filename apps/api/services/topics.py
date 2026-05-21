"""Topic generation service.

Ports legacy helpers from backend/debby.py (get_parli_topic, get_mspdp_topic,
coin_toss). CSV files ship under apps/api/data/ so the API is self-contained.
"""

from __future__ import annotations

import csv
import random
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_PARLI_CSV = _DATA_DIR / "parlires.csv"
_MSPDP_CSV = _DATA_DIR / "msres.csv"

_TOURNAMENT_YEAR_SUFFIX = re.compile(r"\s+\d{4}-\d{2}$")

Side = Literal["aff", "neg"]


@lru_cache(maxsize=1)
def _load_parli_rows() -> tuple[tuple[str, str], ...]:
    """Return tuple of (tournament_name_normalized, resolution) pairs."""
    rows: list[tuple[str, str]] = []
    with open(_PARLI_CSV, encoding="UTF-16", newline="") as file:
        reader = csv.DictReader(file, delimiter="\t")
        for row in reader:
            resolution = (row.get("Resolution") or "").strip()
            if not resolution:
                continue
            tournament_name = (row.get("Tournament") or "").strip()
            tournament_name = _TOURNAMENT_YEAR_SUFFIX.sub("", tournament_name)
            rows.append((tournament_name, resolution))
    return tuple(rows)


@lru_cache(maxsize=1)
def _load_mspdp_resolutions() -> tuple[str, ...]:
    with open(_MSPDP_CSV, newline="") as file:
        reader = csv.DictReader(file, delimiter="\t")
        resolutions = [
            (row.get("Resolution") or "").strip()
            for row in reader
            if (row.get("Resolution") or "").strip()
        ]
    return tuple(resolutions)


def get_parli_topic(tournament: str | None) -> str:
    """Return a random parli resolution, optionally scoped to a tournament.

    Falls back to picking from all resolutions if the tournament has no match.
    """
    rows = _load_parli_rows()
    if not rows:
        raise ValueError("No Parli topics available.")

    if tournament:
        matching = [res for t, res in rows if t == tournament]
        if matching:
            return random.choice(matching)

    all_resolutions = [res for _, res in rows]
    if not all_resolutions:
        raise ValueError("No Parli topics available.")
    return random.choice(all_resolutions)


def get_mspdp_topic() -> str:
    """Return a random MSPDP resolution."""
    resolutions = _load_mspdp_resolutions()
    if not resolutions:
        raise ValueError("No MSPDP topics found.")
    return random.choice(resolutions)


def coin_toss() -> Side:
    """Return 'aff' or 'neg' with equal probability."""
    return "aff" if random.randint(0, 1) == 0 else "neg"
