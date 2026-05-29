import type { ActivityDay } from "@/lib/progress";

function shade(count: number): string {
  if (count <= 0) return "bg-slate-100";
  if (count === 1) return "bg-teal/30";
  if (count === 2) return "bg-teal/60";
  if (count === 3) return "bg-teal/80";
  return "bg-teal";
}

export function ActivityHeatmap({ days }: { days: ActivityDay[] }) {
  // 12 weeks × 7 days, grouped into columns.
  const columns: ActivityDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    columns.push(days.slice(i, i + 7));
  }
  const total = days.reduce((s, d) => s + d.count, 0);
  const activeDays = days.filter((d) => d.count > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-500">Last 12 weeks</span>
        <span className="text-slate-700">
          {activeDays} active days · {total} sessions
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-1.5">
            {col.map((day) => (
              <div
                key={day.date}
                title={`${day.date} · ${day.count}`}
                className={`h-3.5 w-3.5 shrink-0 rounded-sm ${shade(day.count)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
