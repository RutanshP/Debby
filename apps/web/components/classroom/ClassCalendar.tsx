"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  assignmentHref,
  isCoachAssignmentSummary,
  type AssignmentRecipientDetail,
  type CoachAssignmentSummary,
} from "@/lib/classroom";

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isToday(year: number, month: number, day: number): boolean {
  const today = new Date();
  return (
    today.getFullYear() === year &&
    today.getMonth() === month &&
    today.getDate() === day
  );
}

function parseIsoDate(isoString: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
    };
  } catch {
    return null;
  }
}

interface DayAssignments {
  [key: number]: Array<AssignmentRecipientDetail | CoachAssignmentSummary>;
}

export function ClassCalendar({
  assignments,
  classId,
}: {
  assignments: Array<AssignmentRecipientDetail | CoachAssignmentSummary>;
  classId?: string;
}) {
  const today = new Date();
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [displayYear, setDisplayYear] = useState(today.getFullYear());

  const assignmentsByDay = useMemo(() => {
    const grouped: DayAssignments = {};
    assignments.forEach((item) => {
      if (!item.assignment.due_at) return;
      if (classId && item.assignment.class_id !== classId) return;
      const parsed = parseIsoDate(item.assignment.due_at);
      if (!parsed) return;
      if (parsed.year !== displayYear || parsed.month !== displayMonth) return;
      const dayKey = parsed.day;
      if (!grouped[dayKey]) {
        grouped[dayKey] = [];
      }
      grouped[dayKey].push(item);
    });
    return grouped;
  }, [assignments, displayMonth, displayYear]);

  const daysInMonth = getDaysInMonth(displayYear, displayMonth);
  const firstDayOfWeek = getFirstDayOfMonth(displayYear, displayMonth);

  const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    new Date(displayYear, displayMonth, 1),
  );

  function goToPreviousMonth() {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
  }

  function goToNextMonth() {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
  }

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const calendarDays: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-900">{monthName}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={goToPreviousMonth}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={goToNextMonth}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Next
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-96 grid-cols-7 gap-1">
          {weekDays.map((dayName) => (
            <div
              key={dayName}
              className="rounded-md bg-slate-100 px-2 py-2 text-center text-xs font-semibold text-slate-700"
            >
              {dayName}
            </div>
          ))}

          {calendarDays.map((day, index) => (
            <div
              key={`${displayYear}-${displayMonth}-${day}-${index}`}
              className={`min-h-24 rounded-md border p-2 ${
                day === null
                  ? "border-transparent bg-slate-50"
                  : isToday(displayYear, displayMonth, day)
                    ? "border-teal bg-teal/5"
                    : "border-slate-200 bg-white"
              }`}
            >
              {day && (
                <div className="flex flex-col gap-1">
                  <div className={`text-xs font-semibold ${isToday(displayYear, displayMonth, day) ? "text-teal" : "text-slate-700"}`}>
                    {day}
                  </div>
                  <div className="flex flex-col gap-1">
                    {(assignmentsByDay[day] || []).map((item) =>
                      isCoachAssignmentSummary(item) ? (
                        <div
                          key={item.assignment.id}
                          className="truncate rounded-sm bg-teal/10 px-1.5 py-0.5 text-xs font-medium text-teal-dark"
                          title={item.assignment.title}
                        >
                          {item.assignment.title}
                        </div>
                      ) : (
                        <Link
                          key={item.recipient.id}
                          href={assignmentHref(item)}
                          className="truncate rounded-sm bg-teal/10 px-1.5 py-0.5 text-xs font-medium text-teal-dark transition hover:bg-teal/20"
                          title={item.assignment.title}
                        >
                          {item.assignment.title}
                        </Link>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
