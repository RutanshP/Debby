"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

export interface HistoryRound {
  id: string;
  topic: string;
  format: string;
  side: "aff" | "neg";
  winner_side: "aff" | "neg" | null;
  flow?: {
    ballot?: {
      winner?: "aff" | "neg" | string | null;
    } | string | null;
  } | null;
  created_at: string;
}

interface HistoryListProps {
  rounds: HistoryRound[];
  pageSize?: number;
}

const SIDE_LABEL: Record<string, string> = {
  aff: "Affirmative",
  neg: "Negative",
};

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function resolvedWinner(round: HistoryRound): "aff" | "neg" | null {
  if (round.winner_side === "aff" || round.winner_side === "neg") {
    return round.winner_side;
  }
  const flowWinner =
    typeof round.flow?.ballot === "object" && round.flow.ballot !== null
      ? round.flow.ballot.winner
      : null;
  return flowWinner === "aff" || flowWinner === "neg" ? flowWinner : null;
}

function winnerLabel(round: HistoryRound): string {
  const winner = resolvedWinner(round);
  if (!winner) return "N/A";
  return winner === round.side ? "You" : "Debby";
}

export function HistoryList({ rounds, pageSize = 20 }: HistoryListProps) {
  const [items, setItems] = useState(rounds);
  const [offset, setOffset] = useState(rounds.length);
  const [hasMore, setHasMore] = useState(rounds.length >= pageSize);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadMore() {
    setIsLoadingMore(true);
    setLoadError(null);
    try {
      const next = await apiFetch<HistoryRound[]>(
        `/api/rounds/summary?limit=${pageSize}&offset=${offset}`,
      );
      setItems((current) => [...current, ...next]);
      setOffset((current) => current + next.length);
      setHasMore(next.length === pageSize);
    } catch {
      setLoadError("Could not load more rounds. Try again in a moment.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  const total = items.length;
  const userWins = items.filter(
    (r) => resolvedWinner(r) === r.side,
  ).length;
  const debbyWins = items.filter(
    (r) => {
      const winner = resolvedWinner(r);
      return winner !== null && winner !== r.side;
    },
  ).length;
  const winRate = total > 0 ? Math.round((userWins / total) * 1000) / 10 : 0;

  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <h2 className="text-lg font-semibold text-slate-700">No rounds yet</h2>
        <p className="mt-2 text-sm text-slate-500">
          Your completed debate rounds will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <aside
        className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4"
        aria-label="Aggregate stats"
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
          <div className="mt-1 text-xl font-semibold text-slate-900" data-testid="stat-total">
            {total}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Your Wins</div>
          <div className="mt-1 text-xl font-semibold text-teal" data-testid="stat-user-wins">
            {userWins}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Debby Wins</div>
          <div className="mt-1 text-xl font-semibold text-slate-700" data-testid="stat-debby-wins">
            {debbyWins}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Win Rate</div>
          <div className="mt-1 text-xl font-semibold text-slate-900" data-testid="stat-win-rate">
            {winRate}%
          </div>
        </div>
      </aside>

      <ul className="space-y-3">
        {items.map((r) => {
          const winner = resolvedWinner(r);
          const userWon = winner === r.side;
          return (
            <li key={r.id}>
              <Link
                href={`/history/${r.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal/50 hover:shadow"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">{formatDate(r.created_at)}</div>
                    <h3 className="mt-1 truncate text-base font-semibold text-slate-900">
                      {r.topic}
                    </h3>
                    <div className="mt-1 text-xs text-slate-500">
                      {r.format} &middot; {SIDE_LABEL[r.side] ?? r.side}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                      userWon
                        ? "bg-teal/10 text-teal"
                        : winner
                          ? "bg-slate-100 text-slate-600"
                          : "bg-slate-50 text-slate-400"
                    }`}
                  >
                    Winner:{" "}
                    {winnerLabel(r)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : null}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={isLoadingMore}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal/50 hover:text-teal disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
