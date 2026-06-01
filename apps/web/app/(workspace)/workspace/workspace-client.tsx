"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatDate, type ClassListItem } from "@/lib/classroom";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20";
const labelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-60";

export function WorkspaceClient() {
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newClassName, setNewClassName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [submitting, setSubmitting] = useState<"create" | "join" | null>(null);
  const hasCoachClass = classes.some((item) => item.role === "coach");
  const hasCompetitorClass = classes.some((item) => item.role === "competitor");
  const showPersonalWorkspace = hasCoachClass || !hasCompetitorClass;

  async function loadClasses() {
    setError(null);
    const rows = await apiFetch<ClassListItem[]>("/api/classes");
    setClasses(rows);
  }

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      try {
        const rows = await apiFetch<ClassListItem[]>("/api/classes");
        if (!ignore) setClasses(rows);
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
    setSubmitting("create");
    setError(null);
    try {
      await apiFetch("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name: newClassName.trim() }),
      });
      setNewClassName("");
      await loadClasses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create class");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleJoinClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!joinCode.trim()) return;
    setSubmitting("join");
    setError(null);
    try {
      await apiFetch("/api/classes/join", {
        method: "POST",
        body: JSON.stringify({ join_code: joinCode.trim().toUpperCase() }),
      });
      setJoinCode("");
      await loadClasses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join class");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-teal-dark">Choose Workspace</h1>
        <p className="text-slate-600">
          {showPersonalWorkspace
            ? "Use Debby on your own, or enter a classroom workspace."
            : "Open your classroom workspace and practice there."}
        </p>
      </header>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {showPersonalWorkspace && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Personal Debby</h2>
              <p className="text-sm text-slate-600">
                Practice rounds, drills, case builder, progress, and your library.
              </p>
            </div>
            <Link href="/practice" className={primaryButtonClass}>
              Go to Debby
            </Link>
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <form
          onSubmit={handleCreateClass}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
        >
          <label className={`${labelClass} flex-1`}>
            Create class
            <input
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              className={fieldClass}
              placeholder="Varsity PF"
            />
          </label>
          <button
            type="submit"
            disabled={submitting === "create"}
            className={primaryButtonClass}
          >
            {submitting === "create" ? "Creating..." : "Create"}
          </button>
        </form>

        <form
          onSubmit={handleJoinClass}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
        >
          <label className={`${labelClass} flex-1`}>
            Join class
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              className={`${fieldClass} uppercase`}
              placeholder="ABC123"
            />
          </label>
          <button
            type="submit"
            disabled={submitting === "join"}
            className={secondaryButtonClass}
          >
            {submitting === "join" ? "Joining..." : "Join"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-slate-900">Your Classes</h2>
        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            Loading classes...
          </div>
        ) : classes.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((item) => (
              <Link
                key={item.id}
                href={`/classes?class=${item.id}`}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal/60 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{item.name}</h3>
                    <p className="mt-1 text-sm capitalize text-slate-600">{item.role}</p>
                  </div>
                  {item.role === "competitor" && item.open_assignments > 0 && (
                    <span className="rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal-dark">
                      {item.open_assignments} open
                    </span>
                  )}
                </div>
                <div className="mt-4 text-sm text-slate-500">
                  Joined {formatDate(item.created_at)}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            You are not in any classes yet.
          </div>
        )}
      </section>
    </main>
  );
}
