"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StreamTab } from "@/components/classroom/StreamTab";
import { ClassSettings } from "@/components/classroom/ClassSettings";
import { FeedbackPanel } from "@/components/classroom/FeedbackPanel";
import { GradebookDashboard } from "@/components/classroom/GradebookDashboard";
import { ClassProgressDashboard } from "@/components/classroom/ClassProgressDashboard";
import { apiFetch } from "@/lib/api";
import { useProfileNames } from "@/lib/profiles";
import {
  assignmentHref,
  assignmentTypeLabel,
  formatDate,
  isClassTab,
  isCasePayload,
  isCoachAssignmentSummary,
  isDrillPayload,
  isPracticePayload,
  resultSummary,
  statusLabel,
  submissionHref,
  type AssignmentRecipientDetail,
  type AssignmentType,
  type ClassTab,
  type CoachAssignmentSummary,
  type DrillAssignmentType,
  type PracticeFormat,
  type PracticeSide,
} from "@/lib/classroom";
import {
  classroomKeys,
  useClassDetail,
  useClasses,
  useFeedback,
  useQueryClient,
} from "@/lib/queries/classroom";

type StudentAssignmentFilter = "all" | "active" | "completed" | "overdue";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";

function dueDateToEndOfDayIso(dateValue: string): string | null {
  if (!dateValue) return null;
  const dueDate = new Date(`${dateValue}T23:59:00`);
  return Number.isNaN(dueDate.getTime()) ? null : dueDate.toISOString();
}

function payloadSummary(detail: AssignmentRecipientDetail | CoachAssignmentSummary): string {
  const assignment = detail.assignment;
  if (isDrillPayload(assignment)) {
    return `${assignment.payload.drill_type} drill • ${assignment.payload.timer_seconds}s`;
  }
  if (isPracticePayload(assignment)) {
    return `${assignment.payload.format.toUpperCase()} • ${assignment.payload.side.toUpperCase()} • ${assignment.payload.speech_duration_seconds}s`;
  }
  if (isCasePayload(assignment)) {
    return `${assignment.payload.format.toUpperCase()} • ${assignment.payload.side.toUpperCase()} • Case analysis`;
  }
  return assignmentTypeLabel(assignment.type);
}

function compareDueDate(a?: string | null, b?: string | null): number {
  const aTime = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

function compareCreatedAtDesc(a?: string | null, b?: string | null): number {
  const aTime = a ? new Date(a).getTime() : Number.NEGATIVE_INFINITY;
  const bTime = b ? new Date(b).getTime() : Number.NEGATIVE_INFINITY;
  return bTime - aTime;
}

function isOverdue(item: AssignmentRecipientDetail, now: Date): boolean {
  if (item.recipient.status === "completed" || !item.assignment.due_at) return false;
  return new Date(item.assignment.due_at).getTime() < now.getTime();
}

function isDueThisWeek(item: AssignmentRecipientDetail, now: Date): boolean {
  if (item.recipient.status === "completed" || !item.assignment.due_at) return false;
  const dueTime = new Date(item.assignment.due_at).getTime();
  if (Number.isNaN(dueTime)) return false;
  const weekAhead = new Date(now);
  weekAhead.setDate(now.getDate() + 7);
  return dueTime >= now.getTime() && dueTime <= weekAhead.getTime();
}

function typeBadgeClass(type: AssignmentType): string {
  if (type === "drill") return "bg-amber-100 text-amber-800";
  if (type === "case") return "bg-emerald-100 text-emerald-800";
  return "bg-sky-100 text-sky-800";
}

function statusBadgeClass(status: "assigned" | "completed" | "overdue" | "in_progress"): string {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "overdue") return "bg-red-100 text-red-700";
  if (status === "in_progress") return "bg-amber-100 text-amber-800";
  return "bg-amber-50 text-amber-700";
}

function AssignmentStatCard({
  value,
  label,
  helper,
}: {
  value: number;
  label: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-3xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
      <div className="text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function StudentAssignmentCard({
  item,
  className,
}: {
  item: AssignmentRecipientDetail;
  className: string;
}) {
  const overdue = isOverdue(item, new Date());
  const displayStatus = overdue ? "overdue" : item.recipient.status;
  const targetHref =
    item.recipient.status === "completed" ? submissionHref(item) : assignmentHref(item);

  return (
    <article className={className}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${typeBadgeClass(item.assignment.type)}`}
            >
              {item.assignment.type === "practice_round"
                ? "Practice"
                : assignmentTypeLabel(item.assignment.type)}
            </span>
            <span className="text-xs text-slate-500">
              Posted {formatDate(item.assignment.created_at)}
            </span>
          </div>
          <h3 className="mt-3 text-xl font-semibold text-slate-900">
            {item.assignment.title}
          </h3>
          <p className="mt-2 text-sm text-slate-600">{payloadSummary(item)}</p>
          {item.assignment.instructions && (
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {item.assignment.instructions}
            </p>
          )}
          <div className="mt-3 text-sm text-slate-600">
            Due {formatDate(item.assignment.due_at)}
          </div>
          {item.result && (
            <p className="mt-2 text-sm text-slate-600">{resultSummary(item.result)}</p>
          )}
        </div>

        <div className="flex flex-col items-start gap-3 lg:items-end">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(displayStatus)}`}
          >
            {displayStatus === "overdue" ? "Overdue" : statusLabel(displayStatus)}
          </span>
          <Link
            href={targetHref}
            className="inline-flex items-center gap-2 text-sm font-semibold text-teal transition hover:text-teal-dark"
          >
            {item.recipient.status === "completed" ? "View results" : "Open assignment"}
            <span aria-hidden="true">{"->"}</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

function StudentFeedbackStatus({ recipientId }: { recipientId: string }) {
  const feedbackQuery = useFeedback(recipientId);

  if (feedbackQuery.isLoading) {
    return <p className="mt-2 text-sm text-slate-500">Checking coach feedback...</p>;
  }

  if (feedbackQuery.data?.returned) {
    return (
      <p className="mt-2 text-sm font-medium text-teal-dark">
        Coach feedback available
      </p>
    );
  }

  return <p className="mt-2 text-sm text-slate-500">No feedback yet</p>;
}

export function ClassesClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const requestedClassId = searchParams.get("class");
  const requestedTab = searchParams.get("tab");

  const classesQuery = useClasses();
  const classes = classesQuery.data ?? [];
  const selectedClassId = requestedClassId ?? classes[0]?.id ?? null;
  const classDetailQuery = useClassDetail(selectedClassId);
  const classDetail = classDetailQuery.data;

  const [tab, setTab] = useState<ClassTab>("classwork");
  const [assignmentFilter, setAssignmentFilter] =
    useState<StudentAssignmentFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<AssignmentType>("drill");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignAll, setAssignAll] = useState(true);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [drillType, setDrillType] = useState<DrillAssignmentType>("rebuttal");
  const [drillTimer, setDrillTimer] = useState(60);
  const [practiceFormat, setPracticeFormat] = useState<PracticeFormat>("parli");
  const [practiceSide, setPracticeSide] = useState<PracticeSide>("aff");
  const [practiceTopic, setPracticeTopic] = useState("");
  const [practiceTimer, setPracticeTimer] = useState(120);
  const [caseFormat, setCaseFormat] = useState<PracticeFormat>("parli");
  const [caseSide, setCaseSide] = useState<PracticeSide>("aff");
  const [caseTopic, setCaseTopic] = useState("");
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [expandedFeedback, setExpandedFeedback] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (classesQuery.error || classDetailQuery.error) {
      const queryError = classesQuery.error ?? classDetailQuery.error;
      setError(queryError instanceof Error ? queryError.message : "Failed to load class");
    }
  }, [classDetailQuery.error, classesQuery.error]);

  useEffect(() => {
    if (classes.length === 0) return;
    if (!requestedClassId) {
      router.replace(`/classes?class=${encodeURIComponent(classes[0].id)}&tab=classwork`);
    }
  }, [classes, requestedClassId, router]);

  useEffect(() => {
    if (!requestedTab) {
      setTab("classwork");
      return;
    }
    if (isClassTab(requestedTab)) {
      setTab(requestedTab);
      return;
    }
    if (requestedTab === "calendar") {
      router.replace(
        selectedClassId
          ? `/calendar?class=${encodeURIComponent(selectedClassId)}`
          : "/calendar",
      );
      return;
    }
    if (requestedTab === "progress") {
      router.replace(
        selectedClassId
          ? `/classes?class=${encodeURIComponent(selectedClassId)}&tab=analytics`
          : "/classes",
      );
      return;
    }
    setTab("classwork");
  }, [requestedTab, router, selectedClassId]);

  const studentAssignments = useMemo(() => {
    if (!classDetail) return [];
    return classDetail.assignments
      .filter(
        (item): item is AssignmentRecipientDetail => !isCoachAssignmentSummary(item),
      )
      .sort((left, right) =>
        compareCreatedAtDesc(left.assignment.created_at, right.assignment.created_at),
      );
  }, [classDetail]);

  const coachAssignments = useMemo(() => {
    if (!classDetail || classDetail.role !== "coach") return [];
    return classDetail.assignments
      .filter(isCoachAssignmentSummary)
      .sort((left, right) =>
        compareCreatedAtDesc(left.assignment.created_at, right.assignment.created_at),
      );
  }, [classDetail]);

  const competitors = useMemo(
    () => classDetail?.roster.filter((member) => member.role === "competitor") ?? [],
    [classDetail],
  );

  const { nameFor } = useProfileNames(
    classDetail?.roster.map((member) => member.user_id) ?? [],
  );

  const studentAssignmentStats = useMemo(() => {
    const now = new Date();
    return {
      active: studentAssignments.filter((item) => item.recipient.status !== "completed").length,
      completed: studentAssignments.filter((item) => item.recipient.status === "completed").length,
      dueThisWeek: studentAssignments.filter((item) => isDueThisWeek(item, now)).length,
      overdue: studentAssignments.filter((item) => isOverdue(item, now)).length,
    };
  }, [studentAssignments]);

  const filteredStudentAssignments = useMemo(() => {
    const now = new Date();
    if (assignmentFilter === "active") {
      return studentAssignments.filter((item) => item.recipient.status !== "completed");
    }
    if (assignmentFilter === "completed") {
      return studentAssignments.filter((item) => item.recipient.status === "completed");
    }
    if (assignmentFilter === "overdue") {
      return studentAssignments.filter((item) => isOverdue(item, now));
    }
    return studentAssignments;
  }, [assignmentFilter, studentAssignments]);

  const studentCompletedAssignments = useMemo(
    () =>
      [...studentAssignments]
        .filter((item) => item.recipient.status === "completed")
        .sort((left, right) =>
          compareDueDate(right.recipient.completed_at, left.recipient.completed_at),
        ),
    [studentAssignments],
  );

  const pageTitle = useMemo(() => {
    if (tab === "stream") return "Stream";
    if (tab === "people") return "People";
    if (tab === "results") return "Feedback";
    if (tab === "analytics") return "Analytics";
    if (tab === "settings") return "Class Settings";
    return "Assignments";
  }, [tab]);

  const pageSubtitle = useMemo(() => {
    if (!classDetail) return "";
    if (tab === "stream") {
      return `Updates, materials, and class activity for ${classDetail.class_room.name}.`;
    }
    if (tab === "people") {
      return `Everyone currently in ${classDetail.class_room.name}.`;
    }
    if (tab === "results") {
      return classDetail.role === "coach"
        ? `Review submissions and feedback for ${classDetail.class_room.name}.`
        : `Feedback and results from ${classDetail.class_room.name}.`;
    }
    if (tab === "analytics") {
      return `Performance trends and coaching stats for ${classDetail.class_room.name}.`;
    }
    if (tab === "settings") {
      return `Manage ${classDetail.class_room.name}.`;
    }
    return classDetail.role === "coach"
      ? `Create and manage assignments for ${classDetail.class_room.name}.`
      : `Assignments for ${classDetail.class_room.name}.`;
  }, [classDetail, tab]);

  async function invalidateCurrentClass() {
    if (!selectedClassId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: classroomKeys.list() }),
      queryClient.invalidateQueries({ queryKey: classroomKeys.detail(selectedClassId) }),
    ]);
  }

  async function handleCreateAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classDetail || classDetail.role !== "coach" || !title.trim()) return;
    setSavingAssignment(true);
    setError(null);
    try {
      const payload =
        type === "drill"
          ? { drill_type: drillType, timer_seconds: drillType === "filler" ? 60 : drillTimer }
          : type === "case"
            ? {
                format: caseFormat,
                topic: caseTopic.trim(),
                side: caseSide,
              }
            : {
                format: practiceFormat,
                topic: practiceTopic.trim(),
                side: practiceSide,
                speech_duration_seconds: practiceTimer,
              };
      await apiFetch(`/api/classes/${classDetail.class_room.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          type,
          payload,
          instructions: instructions.trim() || null,
          due_at: dueDateToEndOfDayIso(dueAt),
          assign_all: assignAll,
          recipient_user_ids: assignAll ? null : selectedRecipients,
        }),
      });
      setTitle("");
      setInstructions("");
      setPracticeTopic("");
      setCaseTopic("");
      setSelectedRecipients([]);
      await invalidateCurrentClass();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create assignment");
    } finally {
      setSavingAssignment(false);
    }
  }

  function toggleRecipient(userId: string) {
    setSelectedRecipients((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  if (classesQuery.isLoading) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading classes...
        </div>
      </main>
    );
  }

  if (classes.length === 0) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold text-slate-900">Classes</h1>
          <p className="text-slate-600">
            Use the class menu in the sidebar to create a class or join one with a
            code.
          </p>
        </header>
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">No classes yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Once you create or join a class, assignments, stream, people, and
            feedback will appear here.
          </p>
        </div>
      </main>
    );
  }

  if (!selectedClassId || classDetailQuery.isLoading || !classDetail) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading class...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">{pageTitle}</h1>
          <p className="mt-2 text-slate-600">{pageSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            router.push(
              `/classes?class=${encodeURIComponent(classDetail.class_room.id)}&tab=settings`,
            )
          }
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal hover:text-teal-dark"
        >
          Class settings
        </button>
      </header>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {tab === "classwork" && classDetail.role === "competitor" && (
        <div className="flex flex-col gap-6">
          <section className="grid gap-4 md:grid-cols-3">
            <AssignmentStatCard
              value={studentAssignmentStats.active}
              label="Active assignments"
              helper="Due soon"
            />
            <AssignmentStatCard
              value={studentAssignmentStats.completed}
              label="Completed"
              helper="This class"
            />
            <AssignmentStatCard
              value={studentAssignmentStats.dueThisWeek}
              label="Due this week"
              helper="Stay on track"
            />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: `All (${studentAssignments.length})` },
                  { key: "active", label: `Active (${studentAssignmentStats.active})` },
                  {
                    key: "completed",
                    label: `Completed (${studentAssignmentStats.completed})`,
                  },
                  { key: "overdue", label: `Overdue (${studentAssignmentStats.overdue})` },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setAssignmentFilter(item.key as StudentAssignmentFilter)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      assignmentFilter === item.key
                        ? "bg-teal text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="text-sm font-medium text-slate-500">Sort by: Due date</div>
            </div>

            <div className="mt-6 flex flex-col gap-4">
              {filteredStudentAssignments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No assignments in this view yet.
                </div>
              ) : (
                filteredStudentAssignments.map((item) => (
                  <StudentAssignmentCard
                    key={item.recipient.id}
                    item={item}
                    className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                  />
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {tab === "classwork" && classDetail.role === "coach" && (
        <div className="flex flex-col gap-6">
          <form
            onSubmit={handleCreateAssignment}
            className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-2"
          >
            <label className={labelClass}>
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={fieldClass}
                placeholder="Rebuttal Drill"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 lg:col-span-2">
              Instructions
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                className="min-h-24 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400"
                placeholder="Optional instructions for students."
              />
            </label>
            <label className={labelClass}>
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value as AssignmentType)}
                className={fieldClass}
              >
                <option value="drill">Drill</option>
                <option value="practice_round">Practice round</option>
                <option value="case">Case analysis</option>
              </select>
            </label>

            {type === "drill" ? (
              <>
                <label className={labelClass}>
                  Drill
                  <select
                    value={drillType}
                    onChange={(event) => {
                      const nextType = event.target.value as DrillAssignmentType;
                      setDrillType(nextType);
                      if (nextType === "filler") setDrillTimer(60);
                    }}
                    className={fieldClass}
                  >
                    <option value="rebuttal">Rebuttal</option>
                    <option value="speed">Speed</option>
                    <option value="impact">Impact</option>
                    <option value="contention">Contention</option>
                    <option value="filler">Filler</option>
                  </select>
                </label>
                <label className={labelClass}>
                  Timer
                  <select
                    value={drillTimer}
                    onChange={(event) => setDrillTimer(Number(event.target.value))}
                    disabled={drillType === "filler"}
                    className={fieldClass}
                  >
                    {[30, 60, 120].map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds}s
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : type === "practice_round" ? (
              <>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 lg:col-span-2">
                  Topic
                  <input
                    value={practiceTopic}
                    onChange={(event) => setPracticeTopic(event.target.value)}
                    className={fieldClass}
                    placeholder="Ban the AfD"
                    required={type === "practice_round"}
                  />
                </label>
                <label className={labelClass}>
                  Format
                  <select
                    value={practiceFormat}
                    onChange={(event) =>
                      setPracticeFormat(event.target.value as PracticeFormat)
                    }
                    className={fieldClass}
                  >
                    <option value="parli">Parli</option>
                    <option value="mspdp">MSPDP</option>
                    <option value="public_forum" disabled>
                      Public Forum
                    </option>
                  </select>
                </label>
                <label className={labelClass}>
                  Side
                  <select
                    value={practiceSide}
                    onChange={(event) => setPracticeSide(event.target.value as PracticeSide)}
                    className={fieldClass}
                  >
                    <option value="aff">Affirmative</option>
                    <option value="neg">Negative</option>
                  </select>
                </label>
                <label className={labelClass}>
                  Speech length
                  <select
                    value={practiceTimer}
                    onChange={(event) => setPracticeTimer(Number(event.target.value))}
                    className={fieldClass}
                  >
                    {[30, 45, 60, 90, 120, 180, 240, 300].map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds}s
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className={labelClass}>
                  Format
                  <select
                    value={caseFormat}
                    onChange={(event) => setCaseFormat(event.target.value as PracticeFormat)}
                    className={fieldClass}
                  >
                    <option value="parli">Parli</option>
                    <option value="mspdp">MSPDP</option>
                    <option value="public_forum" disabled>
                      Public Forum
                    </option>
                  </select>
                </label>
                <label className={labelClass}>
                  Side
                  <select
                    value={caseSide}
                    onChange={(event) => setCaseSide(event.target.value as PracticeSide)}
                    className={fieldClass}
                  >
                    <option value="aff">Affirmative</option>
                    <option value="neg">Negative</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 lg:col-span-2">
                  Topic / Resolution
                  <input
                    value={caseTopic}
                    onChange={(event) => setCaseTopic(event.target.value)}
                    className={fieldClass}
                    placeholder="Students will write a case on this topic"
                    required={type === "case"}
                  />
                </label>
              </>
            )}

            <label className={labelClass}>
              Due date
              <input
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className={fieldClass}
              />
            </label>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={assignAll}
                  onChange={(event) => setAssignAll(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal"
                />
                Assign to all competitors
              </label>
              {!assignAll && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {competitors.map((member) => (
                    <label
                      key={member.user_id}
                      className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRecipients.includes(member.user_id)}
                        onChange={() => toggleRecipient(member.user_id)}
                        className="h-4 w-4 rounded border-slate-300 text-teal"
                      />
                      {nameFor(member.user_id)}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-2">
              {competitors.length === 0 && (
                <p className="mb-3 text-sm font-medium text-amber-700">
                  Add at least one competitor before creating assignments.
                </p>
              )}
              <button
                type="submit"
                disabled={savingAssignment || competitors.length === 0}
                className={primaryButtonClass}
              >
                {savingAssignment ? "Creating..." : "Create assignment"}
              </button>
            </div>
          </form>

          <section className="flex flex-col gap-4">
            {coachAssignments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                No assignments yet.
              </div>
            ) : (
              coachAssignments.map((item) => {
                const completed = item.recipients.filter(
                  (recipient) => recipient.status === "completed",
                ).length;
                return (
                  <article
                    key={item.assignment.id}
                    className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${typeBadgeClass(item.assignment.type)}`}
                          >
                            {item.assignment.type === "practice_round"
                              ? "Practice"
                              : assignmentTypeLabel(item.assignment.type)}
                          </span>
                          <span className="text-xs text-slate-500">
                            Due {formatDate(item.assignment.due_at)}
                          </span>
                        </div>
                        <h3 className="mt-3 text-xl font-semibold text-slate-900">
                          {item.assignment.title}
                        </h3>
                        <p className="mt-2 text-sm text-slate-600">
                          {payloadSummary(item)}
                        </p>
                        {item.assignment.instructions && (
                          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {item.assignment.instructions}
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-teal/10 px-3 py-1 text-sm font-semibold text-teal-dark">
                        {completed}/{item.recipients.length} completed
                      </span>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}

      {tab === "stream" && (
        <StreamTab classDetail={classDetail} assignments={studentAssignments} />
      )}

      {tab === "people" && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Coaches</h2>
            <div className="mt-4 flex flex-col gap-3">
              {classDetail.roster
                .filter((member) => member.role === "coach")
                .map((member) => (
                  <div
                    key={`coach-${member.user_id}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="font-medium text-slate-900">
                      {nameFor(member.user_id)}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">Coach</div>
                  </div>
                ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Competitors</h2>
            <div className="mt-4 flex flex-col gap-3">
              {classDetail.roster
                .filter((member) => member.role === "competitor")
                .map((member) => (
                  <div
                    key={member.user_id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="font-medium text-slate-900">
                      {nameFor(member.user_id)}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">Competitor</div>
                  </div>
                ))}
            </div>
          </div>
        </section>
      )}

      {tab === "results" && classDetail.role === "coach" && (
        <div className="flex flex-col gap-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <GradebookDashboard classId={classDetail.class_room.id} embedded={true} />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-5">
              <h2 className="text-lg font-semibold text-slate-900">Submission details</h2>
              <p className="mt-1 text-sm text-slate-600">
                Review completed work, open submissions, and send feedback.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Assignment</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Completed</th>
                    <th className="px-4 py-3">Result</th>
                    <th className="px-4 py-3">Review</th>
                    <th className="px-4 py-3">Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {coachAssignments.flatMap((summary) =>
                    summary.recipients.flatMap((recipient) => {
                      const isOpen = expandedFeedback.has(recipient.id);
                      return [
                        <tr key={recipient.id}>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {summary.assignment.title}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {nameFor(recipient.user_id)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {statusLabel(recipient.status)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {recipient.completed_at
                              ? formatDate(recipient.completed_at)
                              : "-"}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {resultSummary(summary.results[recipient.id])}
                          </td>
                          <td className="px-4 py-3">
                            {recipient.status === "completed" ? (
                              <Link
                                href={`/classes/submissions/${recipient.id}?class=${classDetail.class_room.id}`}
                                className="text-sm font-medium text-teal transition hover:text-teal-dark"
                              >
                                View
                              </Link>
                            ) : (
                              <span className="text-sm text-slate-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedFeedback((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(recipient.id)) {
                                    next.delete(recipient.id);
                                  } else {
                                    next.add(recipient.id);
                                  }
                                  return next;
                                })
                              }
                              className="text-xs font-medium text-teal underline hover:text-teal-dark"
                            >
                              {isOpen ? "Close" : "Feedback"}
                            </button>
                          </td>
                        </tr>,
                        isOpen && (
                          <tr key={`${recipient.id}-feedback`}>
                            <td colSpan={7} className="px-4 pb-4">
                              <FeedbackPanel recipientId={recipient.id} isCoach={true} />
                            </td>
                          </tr>
                        ),
                      ].filter(Boolean);
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "results" && classDetail.role === "competitor" && (
        <section className="flex flex-col gap-4">
          {studentCompletedAssignments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Completed assignments and returned feedback will show up here.
            </div>
          ) : (
            studentCompletedAssignments.map((item) => (
              <Link
                key={item.recipient.id}
                href={submissionHref(item)}
                className="block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal/40"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {item.assignment.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {resultSummary(item.result)}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {statusLabel(item.recipient.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Open this assignment to view detailed results and coach feedback.
                </p>
                <StudentFeedbackStatus recipientId={item.recipient.id} />
              </Link>
            ))
          )}
        </section>
      )}

      {tab === "analytics" && classDetail.role === "coach" && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <ClassProgressDashboard classId={classDetail.class_room.id} />
        </section>
      )}

      {tab === "analytics" && classDetail.role !== "coach" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Analytics is available for coaches only.
        </div>
      )}

      {tab === "settings" && (
        <ClassSettings
          classDetail={classDetail}
          onRefresh={invalidateCurrentClass}
          onClose={async () => {
            await queryClient.invalidateQueries({ queryKey: classroomKeys.list() });
            router.push("/classes");
          }}
        />
      )}
    </main>
  );
}
