"use client";

import Link from "next/link";
import { useMemo } from "react";
import { assignmentHref, formatDate, type AssignmentRecipientDetail } from "@/lib/classroom";

interface UpcomingCardProps {
  assignments: AssignmentRecipientDetail[];
  onViewAll?: () => void;
}

const MAX_UPCOMING = 3;

export function UpcomingCard({ assignments, onViewAll }: UpcomingCardProps) {
  const upcoming = useMemo(() => {
    return assignments
      .filter((item) => item.recipient.status !== "completed")
      .filter((item) => item.assignment.due_at != null)
      .sort((a, b) => {
        const aDate = new Date(a.assignment.due_at!).getTime();
        const bDate = new Date(b.assignment.due_at!).getTime();
        return aDate - bDate;
      })
      .slice(0, MAX_UPCOMING);
  }, [assignments]);

  return (
    <aside
      aria-label="Upcoming work"
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">Upcoming</h2>

      {upcoming.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <span className="text-2xl" aria-hidden="true">
            🎉
          </span>
          <p className="text-sm font-medium text-slate-700">
            Woohoo, no work due soon!
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {upcoming.map((item) => (
            <li key={item.recipient.id} className="py-3 first:pt-0 last:pb-0">
              <Link
                href={assignmentHref(item)}
                className="group flex flex-col gap-0.5 rounded-md p-1 -mx-1 transition hover:bg-teal/5"
              >
                <span className="text-sm font-medium text-slate-900 group-hover:text-teal-dark">
                  {item.assignment.title}
                </span>
                <span className="text-xs text-slate-500">
                  Due {formatDate(item.assignment.due_at)}
                </span>
                <span className="text-xs text-slate-400">{item.class_room.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-1 text-left text-sm font-medium text-teal transition hover:text-teal-dark hover:underline"
        >
          View all
        </button>
      )}
    </aside>
  );
}
