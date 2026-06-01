"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  assignmentTypeLabel,
  formatDate,
  isCoachAssignmentSummary,
  isDrillPayload,
  isPracticePayload,
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

type Tab = "classwork" | "people" | "results";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-60";

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

function resultSummary(result?: Record<string, unknown> | null): string {
  if (!result) return "No result yet";
  if (typeof result.numeric_score === "number") return `Score ${result.numeric_score}/10`;
  const score = result.score;
  if (score && typeof score === "object" && "score" in score) {
    const numeric = (score as { score?: unknown }).score;
    if (typeof numeric === "number" || typeof numeric === "string") {
      return `Score ${numeric}/10`;
    }
  }
  if (typeof result.wpm === "number") return `${Math.round(result.wpm)} WPM`;
  if (result.winner_side === "aff" || result.winner_side === "neg") {
    return `Winner: ${result.winner_side}`;
  }
  if (typeof result.rfd === "string" && result.rfd.trim()) {
    return result.rfd.trim().slice(0, 80);
  }
  return "Result saved";
}

function assignmentHref(detail: AssignmentRecipientDetail): string {
  const id = detail.recipient.id;
  return detail.assignment.type === "drill"
    ? `/drills?assignment=${id}`
    : `/?assignment=${id}`;
}

export function ClassesClient() {
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecipientDetail[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classDetail, setClassDetail] = useState<ClassDetail | null>(null);
  const [tab, setTab] = useState<Tab>("classwork");
  const [loading, setLoading] = useState(true);
  const [classLoading, setClassLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newClassName, setNewClassName] = useState("");
  const [joinCode, setJoinCode] = useState("");

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

  const unfinishedCount = useMemo(
    () => assignments.filter((item) => item.recipient.status !== "completed").length,
    [assignments],
  );

  const competitors = useMemo(
    () => classDetail?.roster.filter((member) => member.role === "competitor") ?? [],
    [classDetail],
  );

  async function loadBase(nextClassId = selectedClassId) {
    setError(null);
    const [classRows, assignmentRows] = await Promise.all([
      apiFetch<ClassListItem[]>("/api/classes"),
      apiFetch<AssignmentRecipientDetail[]>("/api/assignments"),
    ]);
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
    async function load() {
      setLoading(true);
      try {
        const [classRows, assignmentRows] = await Promise.all([
          apiFetch<ClassListItem[]>("/api/classes"),
          apiFetch<AssignmentRecipientDetail[]>("/api/assignments"),
        ]);
        if (ignore) return;
        setClasses(classRows);
        setAssignments(assignmentRows);
        if (classRows[0]) {
          setSelectedClassId(classRows[0].id);
          await loadClass(classRows[0].id);
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
  }, []);

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newClassName.trim()) return;
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name: newClassName.trim() }),
      });
      setNewClassName("");
      setSelectedClassId(created.id);
      await loadBase(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create class");
    }
  }

  async function handleJoinClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!joinCode.trim()) return;
    setError(null);
    try {
      const joined = await apiFetch<{ id: string }>("/api/classes/join", {
        method: "POST",
        body: JSON.stringify({ join_code: joinCode.trim().toUpperCase() }),
      });
      setJoinCode("");
      setSelectedClassId(joined.id);
      await loadBase(joined.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join class");
    }
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
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
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
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-teal-dark">Classes</h1>
        <p className="text-slate-600">
          {unfinishedCount} unfinished assignment{unfinishedCount === 1 ? "" : "s"}
        </p>
      </header>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <form
          onSubmit={handleCreateClass}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
        >
          <label className={`${labelClass} flex-1`}>
            New class
            <input
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              className={fieldClass}
              placeholder="Varsity PF"
            />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Create
          </button>
        </form>

        <form
          onSubmit={handleJoinClass}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
        >
          <label className={`${labelClass} flex-1`}>
            Join code
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              className={`${fieldClass} uppercase`}
              placeholder="ABC123"
            />
          </label>
          <button type="submit" className={secondaryButtonClass}>
            Join
          </button>
        </form>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Loading classes...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex flex-col gap-3">
            {classes.map((item) => {
              const active = item.id === selectedClassId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadClass(item.id)}
                  className={`rounded-lg border p-4 text-left shadow-sm transition ${
                    active
                      ? "border-teal bg-teal/5 ring-2 ring-teal"
                      : "border-slate-200 bg-white hover:border-teal/60"
                  }`}
                >
                  <div className="font-semibold text-slate-900">{item.name}</div>
                  <div className="mt-1 text-sm capitalize text-slate-600">{item.role}</div>
                  {item.role === "coach" ? (
                    <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 font-mono text-sm text-slate-700">
                      {item.join_code}
                    </div>
                  ) : (
                    <div className="mt-3 text-sm font-medium text-teal-dark">
                      {item.open_assignments} open
                    </div>
                  )}
                </button>
              );
            })}
            {classes.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                No classes yet.
              </div>
            )}
          </aside>

          <section className="flex flex-col gap-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">
                    Assignments
                  </h2>
                  <p className="text-sm text-slate-600">
                    {unfinishedCount} unfinished
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {assignments.map((item) => (
                  <article
                    key={item.recipient.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {item.assignment.title}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {item.class_room.name} / {payloadSummary(item)}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {statusLabel(item.recipient.status)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-500">
                        Due {formatDate(item.assignment.due_at)}
                      </span>
                      {item.recipient.status === "completed" ? (
                        <span className="font-medium text-teal-dark">Done</span>
                      ) : (
                        <Link href={assignmentHref(item)} className={primaryButtonClass}>
                          Start
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
                {assignments.length === 0 && (
                  <p className="text-sm text-slate-600">No assignments yet.</p>
                )}
              </div>
            </section>

            {classDetail && (
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <header className="border-b border-slate-200 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">
                        {classDetail.class_room.name}
                      </h2>
                      <p className="text-sm capitalize text-slate-600">
                        {classDetail.role}
                      </p>
                    </div>
                    {classDetail.role === "coach" && (
                      <div className="rounded-md bg-slate-100 px-3 py-2 font-mono text-sm text-slate-700">
                        {classDetail.class_room.join_code}
                      </div>
                    )}
                  </div>
                  <nav className="mt-5 flex gap-2" aria-label="Class tabs">
                    {(["classwork", "people", "results"] as Tab[]).map((nextTab) => (
                      <button
                        key={nextTab}
                        type="button"
                        onClick={() => setTab(nextTab)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
                          tab === nextTab
                            ? "bg-teal text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-teal/10"
                        }`}
                      >
                        {nextTab}
                      </button>
                    ))}
                  </nav>
                </header>

                <div className="p-5">
                  {classLoading ? (
                    <p className="text-sm text-slate-600">Loading class...</p>
                  ) : tab === "classwork" ? (
                    <div className="flex flex-col gap-5">
                      {classDetail.role === "coach" && (
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
                              type="datetime-local"
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
                      )}

                      <div className="grid gap-3">
                        {classDetail.assignments.map((item) => {
                          if (isCoachAssignmentSummary(item)) {
                            const completed = item.recipients.filter(
                              (recipient) => recipient.status === "completed",
                            ).length;
                            return (
                              <article
                                key={item.assignment.id}
                                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
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
                              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                            >
                              <h3 className="font-semibold text-slate-900">
                                {item.assignment.title}
                              </h3>
                              <p className="text-sm text-slate-600">
                                {payloadSummary(item)}
                              </p>
                            </article>
                          );
                        })}
                      </div>
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
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {coachAssignments.flatMap((summary) =>
                            summary.recipients.map((recipient) => (
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
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {classDetail.assignments.map((item) => {
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
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
