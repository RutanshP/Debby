import Link from "next/link";
import type { ProgressRound } from "@/lib/progress";

const SIDE_LABEL: Record<string, string> = {
  aff: "Affirmative",
  neg: "Negative",
};

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function resolvedWinner(r: ProgressRound): "aff" | "neg" | null {
  if (r.winner_side === "aff" || r.winner_side === "neg") return r.winner_side;
  const ballot = r.flow?.ballot;
  if (ballot && typeof ballot === "object") {
    const w = ballot.winner;
    if (w === "aff" || w === "neg") return w;
  }
  return null;
}

export function RecentRoundsList({ rounds }: { rounds: ProgressRound[] }) {
  if (rounds.length === 0) {
    return (
      <p className="text-sm text-slate-500">No rounds yet — your latest will show here.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {rounds.map((r) => {
        const winner = resolvedWinner(r);
        const userWon = winner !== null && winner === r.side;
        return (
          <li key={r.id}>
            <Link
              href={`/history/${r.id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm transition hover:border-teal/50 hover:shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-900">{r.topic}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {formatDate(r.created_at)} · {r.side ? SIDE_LABEL[r.side] : "—"}
                  {typeof r.average_wpm === "number" ? ` · ${r.average_wpm} wpm` : ""}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  userWon
                    ? "bg-teal/10 text-teal"
                    : winner
                      ? "bg-slate-100 text-slate-600"
                      : "bg-slate-50 text-slate-400"
                }`}
              >
                {userWon ? "Won" : winner ? "Lost" : "—"}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
