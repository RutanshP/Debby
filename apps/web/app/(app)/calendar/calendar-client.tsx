"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { ClassCalendar } from "@/components/classroom/ClassCalendar";
import { apiFetch } from "@/lib/api";
import {
  isCoachAssignmentSummary,
  type AssignmentRecipientDetail,
  type ClassDetail,
  type CoachAssignmentSummary,
} from "@/lib/classroom";
import { classroomKeys, useClasses } from "@/lib/queries/classroom";

type CalendarItem = AssignmentRecipientDetail | CoachAssignmentSummary;

export function CalendarClient() {
  const classesQuery = useClasses();
  const classes = classesQuery.data ?? [];

  const detailQueries = useQueries({
    queries: classes.map((item) => ({
      queryKey: classroomKeys.detail(item.id),
      queryFn: () => apiFetch<ClassDetail>(`/api/classes/${item.id}`),
      enabled: classes.length > 0,
    })),
  });

  const loadingDetails = detailQueries.some((query) => query.isLoading);
  const detailError = detailQueries.find((query) => query.error)?.error;

  const calendarItems = useMemo(() => {
    const items: CalendarItem[] = [];
    detailQueries.forEach((query) => {
      const detail = query.data;
      if (!detail) return;
      if (detail.role === "coach") {
        items.push(...detail.assignments.filter(isCoachAssignmentSummary));
      } else {
        items.push(
          ...detail.assignments.filter(
            (assignment): assignment is AssignmentRecipientDetail =>
              !isCoachAssignmentSummary(assignment),
          ),
        );
      }
    });
    return items;
  }, [detailQueries]);

  if (classesQuery.isLoading || loadingDetails) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading calendar...
        </div>
      </main>
    );
  }

  if (classesQuery.error || detailError) {
    const message =
      classesQuery.error instanceof Error
        ? classesQuery.error.message
        : detailError instanceof Error
          ? detailError.message
          : "Failed to load calendar";
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {message}
        </div>
      </main>
    );
  }

  if (classes.length === 0) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold text-slate-900">Calendar</h1>
          <p className="text-slate-600">
            Your global assignment calendar will appear once you join or create a class.
          </p>
        </header>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold text-slate-900">Calendar</h1>
        <p className="text-slate-600">
          All assignments across your classes, in one place.
        </p>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <ClassCalendar assignments={calendarItems} />
      </section>
    </main>
  );
}
