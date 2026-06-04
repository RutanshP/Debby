"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Weakness } from "@/lib/progress";
import { withClassContext } from "@/lib/classroom";

export function WeaknessSpotlight({ weakness }: { weakness: Weakness | null }) {
  const searchParams = useSearchParams();
  const classId = searchParams.get("class");

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
        href={withClassContext(weakness.href, classId)}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5"
      >
        Start drill
      </Link>
    </div>
  );
}
