"use client";

import type { ClassRole } from "@/lib/classroom";

interface ClassBannerProps {
  className: string;
  role?: ClassRole;
  joinCode?: string;
}

export function ClassBanner({ className, role, joinCode }: ClassBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal to-teal-dark px-8 py-10 text-white shadow-lg">
      {/* Decorative circles */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-8 -left-8 h-36 w-36 rounded-full bg-white/10"
      />

      <div className="relative z-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm font-medium uppercase tracking-widest text-white/70">
            {role ? (role === "coach" ? "Coach" : "Competitor") : "Class"}
          </p>
          <h1 className="text-3xl font-bold leading-tight">{className}</h1>
        </div>

        {joinCode && (
          <div className="rounded-lg bg-white/20 px-4 py-2 backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
              Join code
            </p>
            <p className="font-mono text-lg font-bold tracking-widest">{joinCode}</p>
          </div>
        )}
      </div>
    </div>
  );
}
