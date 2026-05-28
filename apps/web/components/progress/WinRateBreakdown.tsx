import type { WinRateBreakdown } from "@/lib/progress";

function Bar({
  label,
  rounds,
  winPct,
}: {
  label: string;
  rounds: number;
  winPct: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          {rounds === 0 ? "—" : `${winPct}% · ${rounds}`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-teal transition-all"
          style={{ width: `${Math.min(winPct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function WinRateBreakdownCard({ data }: { data: WinRateBreakdown }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          By side
        </div>
        <Bar label="Affirmative" rounds={data.bySide.aff.rounds} winPct={data.bySide.aff.winPct} />
        <Bar label="Negative" rounds={data.bySide.neg.rounds} winPct={data.bySide.neg.winPct} />
      </div>
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          By format
        </div>
        <Bar label="Parliamentary" rounds={data.byFormat.parli.rounds} winPct={data.byFormat.parli.winPct} />
        <Bar label="MSPDP" rounds={data.byFormat.mspdp.rounds} winPct={data.byFormat.mspdp.winPct} />
      </div>
    </div>
  );
}
