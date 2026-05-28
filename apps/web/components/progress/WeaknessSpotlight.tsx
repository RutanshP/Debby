import Link from "next/link";
import type { Weakness } from "@/lib/progress";

export function WeaknessSpotlight({ weakness }: { weakness: Weakness | null }) {
  if (!weakness) {
    return (
      <p className="text-sm text-slate-500">
        Finish more rounds for Debby to recommend a focus area.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <span className="inline-flex rounded-full bg-teal/10 px-3 py-1 text-xs font-medium text-teal">
          Recommended {weakness.count}×
        </span>
        <div className="mt-2 text-base font-semibold text-slate-900">{weakness.label}</div>
        <p className="mt-1 text-sm text-slate-500">
          Debby has flagged this as your most common growth area lately.
        </p>
      </div>
      <Link
        href={weakness.href}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5"
      >
        Start drill
      </Link>
    </div>
  );
}
