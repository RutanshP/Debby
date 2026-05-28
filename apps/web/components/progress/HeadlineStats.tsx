import type { HeadlineStats } from "@/lib/progress";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function HeadlineStatsRow({ stats }: { stats: HeadlineStats }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
      <StatCard label="Rounds" value={String(stats.totalRounds)} />
      <StatCard label="Win Rate" value={`${stats.winRate}%`} />
      <StatCard
        label="Average WPM"
        value={stats.avgWpm == null ? "—" : String(stats.avgWpm)}
      />
      <StatCard
        label="Practice Minutes"
        value={String(stats.totalPracticeMinutes)}
      />
    </div>
  );
}
