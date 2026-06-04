"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { StreamTab } from "@/components/classroom/StreamTab";
import { useSearchParams } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { ClassSettings } from "@/components/classroom/ClassSettings";
import { getBrowserSupabase } from "@/lib/supabase";
import { CommentThread } from "@/components/classroom/CommentThread";
import { FeedbackPanel } from "@/components/classroom/FeedbackPanel";
import {
  assignmentHref,
  assignmentTypeLabel,
  formatDate,
  isCoachAssignmentSummary,
  isDrillPayload,
  isPracticePayload,
  resultSummary,
  shortId,
  statusLabel,
  type AssignmentRecipientDetail,
  type AssignmentType,
  type ClassDetail,
  type ClassListItem,
  type CoachAssignmentSummary,
  type DrillAssignmentType,
  type PracticeFormat,
  type PracticeSide,
} from "@/lib/classroom";
import { ClassCalendar } from "@/components/classroom/ClassCalendar";
import { ClassBanner } from "@/components/classroom/ClassBanner";
import { UpcomingCard } from "@/components/classroom/UpcomingCard";
import { ClassworkCard } from "@/components/classroom/ClassworkCard";
import { ClassProgressDashboard } from "@/components/classroom/ClassProgressDashboard";

type Tab = "classwork" | "people" | "stream" | "results" | "settings" | "calendar" | "progress";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
const CLASSROOM_CACHE_KEY = "debby-classroom-cache-v1";
const CLASSROOM_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

interface ClassroomPageCache {
  classes: ClassListItem[];
  assignments: AssignmentRecipientDetail[];
  selectedClassId: string | null;
  classDetail: ClassDetail | null;
  savedAt: number;
}

let classroomPageMemoryCache: ClassroomPageCache | null = null;

function isTransientAssignmentReadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.message.includes("JWT issued at future") || error.message.includes("PGRST303");
}

function dueDateToEndOfDayIso(dateValue: string): string | null {
  if (!dateValue) return null;
  const dueDate = new Date(`${dateValue}T23:59:00`);
  return Number.isNaN(dueDate.getTime()) ? null : dueDate.toISOString();
}

function readClassroomCache(): ClassroomPageCache | null {
  const now = Date.now();
  if (classroomPageMemoryCache && now - classroomPageMemoryCache.savedAt <= CLASSROOM_CACHE_MAX_AGE_MS) {
    return classroomPageMemoryCache;
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CLASSROOM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClassroomPageCache;
    if (now - parsed.savedAt > CLASSROOM_CACHE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(CLASSROOM_CACHE_KEY);
      return null;
    }
    classroomPageMemoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeClassroomCache(cache: ClassroomPageCache) {
  classroomPageMemoryCache = cache;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CLASSROOM_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures; fresh fetches still work.
  }
}

function payloadSummary(detail: AssignmentRecipientDetail | CoachAssignmentSummary): string {
  const assignment = detail.assignment;
  if (isDrillPayload(assignment)) {
    return `${assignment.payload.drill_type} / ${assignment.payload.timer_seconds}s`;
  }
  if (isPracticePayload(assignment)) {
    return `${assignment.payload.format} / ${assignment.payload.side} / ${assignment.payload.speech_duration_seconds}s`;
  }
  return assignmentTypeLabel(assignment.type);
}

export function ClassesClient() {
  const searchParams = useSearchParams();
  const requestedClassId = searchParams.get("class");
  const requestedTab = searchParams.get("tab");
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecipientDetail[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classDetail, setClassDetail] = useState<ClassDetail | null>(null);
  const [tab, setTab] = useState<Tab>("classwork");
  const [loading, setLoading] = useState(true);
  const [classLoading, setClassLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<AssignmentType>("drill");
  const [dueAt, setDueAt] = useState("");
  const [assignAll, setAssignAll] = useState(true);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [drillType, setDrillType] = useState<DrillAssignmentType>("rebuttal");
  const [drillTimer, setDrillTimer] = useState(60);
  const [practiceFormat, setPracticeFormat] = useState<PracticeFormat>("parli");
  const [practiceSide, setPracticeSide] = useState<PracticeSide>("aff");
  const [practiceTopic, setPracticeTopic] = useState("");
  const [practiceTimer, setPracticeTimer] = useState(120);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [expandedFeedback, setExpandedFeedback] = useState<Set<string>>(new Set());

  // Resolve the authenticated user's ID once on mount for comment authorship.
  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (session?.user?.id) setCurrentUserId(session.user.id);
      })
      .catch(() => {/* silently ignore; delete buttons won't show */});
  }, []);

  const unfinishedCount = useMemo(
    () => assignments.filter((item) => item.recipient.status !== "completed").length,
    [assignments],
  );

  const competitors = useMemo(
    () => classDetail?.roster.filter((member) => member.role === "competitor") ?? [],
    [classDetail],
  );
  const studentAssignments = useMemo(
    () =>
      assignments.filter((item) =>
        selectedClassId ? item.class_room.id === selectedClassId : true,
      ),
    [assignments, selectedClassId],
  );
  const calendarItems = useMemo(() => {
    if (!classDetail) return [];
    return classDetail.role === "coach"
      ? classDetail.assignments.filter(isCoachAssignmentSummary)
      : studentAssignments;
  }, [classDetail, studentAssignments]);

  useEffect(() => {
    if (loading) return;
    writeClassroomCache({
      classes,
      assignments,
      selectedClassId,
      classDetail,
      savedAt: Date.now(),
    });
  }, [assignments, classDetail, classes, loading, selectedClassId]);

  async function loadBase(nextClassId = selectedClassId) {
    setError(null);
    const classRows = await apiFetch<ClassListItem[]>("/api/classes");
    let assignmentRows: AssignmentRecipientDetail[] = [];
    try {
      assignmentRows = await apiFetch<AssignmentRecipientDetail[]>("/api/assignments");
    } catch (err) {
      if (!isTransientAssignmentReadError(err)) throw err;
    }
    setClasses(classRows);
    setAssignments(assignmentRows);
    if (!nextClassId && classRows.length > 0) {
      nextClassId = classRows[0].id;
      setSelectedClassId(nextClassId);
    }
    if (nextClassId) await loadClass(nextClassId);
  }

  async function loadClass(classId: string) {
    setClassLoading(true);
    try {
      const detail = await apiFetch<ClassDetail>(`/api/classes/${classId}`);
      setClassDetail(detail);
      setSelectedClassId(classId);
    } finally {
      setClassLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    const cached = readClassroomCache();
    if (cached) {
      const cachedClassId =
        requestedClassId ??
        cached.selectedClassId ??
        cached.classes[0]?.id ??
        null;
      if (!ignore) {
        setClasses(cached.classes);
        setAssignments(cached.assignments);
        setSelectedClassId(cachedClassId);
        setClassDetail(
          cached.classDetail && cached.classDetail.class_room.id === cachedClassId
            ? cached.classDetail
            : null,
        );
        setLoading(false);
      }
    }

    async function load() {
      if (!cached) setLoading(true);
      try {
        const classRows = await apiFetch<ClassListItem[]>("/api/classes");
        let assignmentRows: AssignmentRecipientDetail[] = [];
        try {
          assignmentRows = await apiFetch<AssignmentRecipientDetail[]>("/api/assignments");
        } catch (err) {
          if (!isTransientAssignmentReadError(err)) throw err;
        }
        if (ignore) return;
        setClasses(classRows);
        setAssignments(assignmentRows);
        const initialClass =
          classRows.find((row) => row.id === requestedClassId) ?? classRows[0];
        if (initialClass) {
          setSelectedClassId(initialClass.id);
          await loadClass(initialClass.id);
        } else {
          setClassDetail(null);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load classes");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [requestedClassId]);

  useEffect(() => {
    if (
      requestedTab === "classwork" ||
      requestedTab === "people" ||
      requestedTab === "stream" ||
      requestedTab === "results" ||
      requestedTab === "calendar" ||
      requestedTab === "progress"
    ) {
      setTab(requestedTab);
    } else if (classDetail?.role === "competitor") {
      setTab("stream");
    } else {
      setTab("classwork");
    }
  }, [classDetail?.role, requestedTab]);

  async function handleCreateAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classDetail || classDetail.role !== "coach" || !title.trim()) return;
    setSavingAssignment(true);
    setError(null);
    try {
      const payload =
        type === "drill"
          ? { drill_type: drillType, timer_seconds: drillType === "filler" ? 60 : drillTimer }
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
          due_at: dueDateToEndOfDayIso(dueAt),
          assign_all: assignAll,
          recipient_user_ids: assignAll ? null : selectedRecipients,
        }),
      });
      setTitle("");
      setPracticeTopic("");
      setSelectedRecipients([]);
      await loadBase(classDetail.class_room.id);
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

  const coachAssignments =
    classDetail?.role === "coach"
      ? classDetail.assignments.filter(isCoachAssignmentSummary)
      : [];

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-teal-dark">Classroom</h1>
        <Link
          href="/workspace"
          className="inline-flex h-10 w-fit items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5"
        >
          Switch workspace
        </Link>
      </header>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Loading classes...
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          No classes yet.
        </div>
      ) : (
        <section className="flex flex-col gap-5">
            {classes.length > 1 && (
              <nav aria-label="Class list" className="flex flex-wrap gap-2">
                {classes.map((cls) => (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => { setSelectedClassId(cls.id); void loadClass(cls.id); }}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                      selectedClassId === cls.id
                        ? "bg-teal text-white shadow-sm"
                        : "border border-slate-300 bg-white text-slate-700 hover:border-teal hover:text-teal"
                    }`}
                  >
                    {cls.name}
                  </button>
                ))}
              </nav>
            )}

            {classDetail && (
              <section className="flex flex-col gap-5">
                <div className="relative">
                  <ClassBanner
                    className={classDetail.class_room.name}
                    role={classDetail.role}
                    joinCode={classDetail.role === "coach" ? classDetail.class_room.join_code : undefined}
                  />
                  <button
                    type="button"
                    aria-label="Class settings"
                    title="Class settings"
                    onClick={() => setTab("settings")}
                    className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/30 bg-white/10 text-white shadow-sm transition hover:bg-white/20"
                  >
                    {/* Gear icon (SVG) */}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>

                <div>
                  {classDetail.role === "competitor" && (
                    <nav
                      aria-label="Classroom sections"
                      className="mb-5 flex flex-wrap gap-2"
                    >
                      {[
                        { key: "stream", label: "Stream" },
                        { key: "results", label: "Feedback" },
                        { key: "calendar", label: "Calendar" },
                      ].map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setTab(item.key as Tab)}
                          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                            tab === item.key
                              ? "bg-teal text-white"
                              : "border border-slate-200 bg-white text-slate-700 hover:border-teal hover:text-teal-dark"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </nav>
                  )}

                  {classLoading ? (
                    <p className="text-sm text-slate-600">Loading class...</p>
                  ) : tab === "classwork" ? (
                    <div className="flex flex-col gap-5">
                      {/* Student: Upcoming widget + classwork feed */}
                      {classDetail.role === "competitor" && (
                        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                          <UpcomingCard
                            assignments={studentAssignments}
                          />

                          <div className="flex flex-col gap-3">
                            <h2 className="text-base font-semibold text-slate-900">
                              All assignments{" "}
                              <span className="font-normal text-slate-500">
                                ({unfinishedCount} unfinished)
                              </span>
                            </h2>
                            {studentAssignments.length === 0 ? (
                              <p className="text-sm text-slate-600">No assignments yet.</p>
                            ) : (
                              studentAssignments.map((item) => (
                                <ClassworkCard
                                  key={item.recipient.id}
                                  item={item}
                                  href={assignmentHref(item)}
                                />
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {/* Coach: create assignment form + summary list */}
                      {classDetail.role === "coach" && (
                        <>
                          <form
                            onSubmit={handleCreateAssignment}
                            className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:grid-cols-2"
                          >
                            <label className={labelClass}>
                              Title
                              <input
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                className={fieldClass}
                                placeholder="Rebuttal drill"
                                required
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
                            ) : (
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
                                  </select>
                                </label>
                                <label className={labelClass}>
                                  Side
                                  <select
                                    value={practiceSide}
                                    onChange={(event) =>
                                      setPracticeSide(event.target.value as PracticeSide)
                                    }
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
                                    onChange={(event) =>
                                      setPracticeTimer(Number(event.target.value))
                                    }
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

                            <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 lg:col-span-2">
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
                                      className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedRecipients.includes(member.user_id)}
                                        onChange={() => toggleRecipient(member.user_id)}
                                        className="h-4 w-4 rounded border-slate-300 text-teal"
                                      />
                                      Competitor {shortId(member.user_id)}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="lg:col-span-2">
                              {competitors.length === 0 && (
                                <p className="mb-3 text-sm font-medium text-amber-700">
                                  Add at least one competitor with the class code before
                                  creating assignments.
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

                          <div className="grid gap-3">
                            {classDetail.assignments.map((item) => {
                              if (isCoachAssignmentSummary(item)) {
                                const completed = item.recipients.filter(
                                  (recipient) => recipient.status === "completed",
                                ).length;
                                return (
                                  <article
                                    key={item.assignment.id}
                                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                                  >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div>
                                        <h3 className="font-semibold text-slate-900">
                                          {item.assignment.title}
                                        </h3>
                                        <p className="text-sm text-slate-600">
                                          {payloadSummary(item)}
                                        </p>
                                      </div>
                                      <span className="text-sm font-semibold text-teal-dark">
                                        {completed}/{item.recipients.length} completed
                                      </span>
                                    </div>
                                  </article>
                                );
                              }
                              return (
                                <article
                                  key={item.recipient.id}
                                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                                >
                                  <h3 className="font-semibold text-slate-900">
                                    {item.assignment.title}
                                  </h3>
                                  <p className="text-sm text-slate-600">
                                    {payloadSummary(item)}
                                  </p>
                                  <CommentThread
                                    classId={item.class_room.id}
                                    targetType="assignment"
                                    targetId={item.recipient.id}
                                    allowPrivate
                                    currentUserId={currentUserId}
                                    currentUserRole={classDetail?.role === "coach" ? "coach" : "competitor"}
                                  />
                                </article>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  ) : tab === "people" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {classDetail.roster.map((member) => (
                        <div
                          key={`${member.class_id}-${member.user_id}`}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="font-medium text-slate-900">
                            {member.role === "coach" ? "Coach" : "Competitor"}{" "}
                            {shortId(member.user_id)}
                          </div>
                          <div className="mt-1 text-sm capitalize text-slate-600">
                            {member.role}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : tab === "stream" ? (
                    <StreamTab classDetail={classDetail} assignments={studentAssignments} />
                  ) : tab === "settings" ? (
                    <ClassSettings
                      classDetail={classDetail}
                      onRefresh={() => loadBase(classDetail.class_room.id)}
                      onClose={() => {
                        setTab("classwork");
                        void loadBase();
                      }}
                    />
                  ) : tab === "calendar" ? (
                    <ClassCalendar assignments={calendarItems} classId={selectedClassId ?? undefined} />
                  ) : tab === "progress" && classDetail.role === "coach" ? (
                    <ClassProgressDashboard classId={classDetail.class_room.id} />
                  ) : tab === "progress" ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                      <p className="text-sm text-slate-600">Progress view is available for coaches only.</p>
                    </div>
                  ) : classDetail.role === "coach" ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Assignment</th>
                            <th className="px-3 py-2">Student</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Completed</th>
                            <th className="px-3 py-2">Result</th>
                            <th className="px-3 py-2">Review</th>
                            <th className="px-3 py-2">Feedback</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {coachAssignments.flatMap((summary) =>
                            summary.recipients.flatMap((recipient) => {
                              const isOpen = expandedFeedback.has(recipient.id);
                              return [
                                <tr key={recipient.id}>
                                  <td className="px-3 py-2 font-medium text-slate-900">
                                    {summary.assignment.title}
                                  </td>
                                  <td className="px-3 py-2 text-slate-700">
                                    {shortId(recipient.user_id)}
                                  </td>
                                  <td className="px-3 py-2 text-slate-700">
                                    {statusLabel(recipient.status)}
                                  </td>
                                  <td className="px-3 py-2 text-slate-700">
                                    {recipient.completed_at
                                      ? formatDate(recipient.completed_at)
                                      : "-"}
                                  </td>
                                  <td className="px-3 py-2 text-slate-700">
                                    {resultSummary(summary.results[recipient.id])}
                                  </td>
                                  <td className="px-3 py-2">
                                    {recipient.status === "completed" && classDetail ? (
                                      <Link
                                        href={`/classes/submissions/${recipient.id}?class=${classDetail.class_room.id}`}
                                        className="text-sm font-medium text-teal transition hover:text-teal-dark"
                                      >
                                        View
                                      </Link>
                                    ) : (
                                      <span className="text-sm text-slate-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
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
                                      className="text-xs text-teal underline hover:text-teal-dark"
                                    >
                                      {isOpen ? "Close" : "Feedback"}
                                    </button>
                                  </td>
                                </tr>,
                                isOpen && (
                                  <tr key={`${recipient.id}-feedback`}>
                                    <td colSpan={7} className="px-3 pb-3">
                                      <FeedbackPanel
                                        recipientId={recipient.id}
                                        isCoach={true}
                                      />
                                    </td>
                                  </tr>
                                ),
                              ].filter(Boolean);
                            }),
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {studentAssignments.map((item) => {
                        if (isCoachAssignmentSummary(item)) return null;
                        return (
                          <article
                            key={item.recipient.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h3 className="font-semibold text-slate-900">
                                  {item.assignment.title}
                                </h3>
                                <p className="text-sm text-slate-600">
                                  {resultSummary(item.result)}
                                </p>
                              </div>
                              <span className="text-sm font-semibold text-teal-dark">
                                {statusLabel(item.recipient.status)}
                              </span>
                            </div>
                            <FeedbackPanel
                              recipientId={item.recipient.id}
                              isCoach={false}
                            />
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}
        </section>
      )}
    </main>
  );
}
