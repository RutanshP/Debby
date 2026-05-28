import type { DroppedPattern } from "@/lib/progress";

export function DroppedArgumentPatterns({ patterns }: { patterns: DroppedPattern[] }) {
  if (patterns.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Dropped argument patterns will appear once you've finished a few rounds.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {patterns.map((p) => (
        <li
          key={p.tag}
          className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm"
        >
          <span className="min-w-0 truncate text-slate-700">{p.tag}</span>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
            {p.count}×
          </span>
        </li>
      ))}
    </ul>
  );
}
