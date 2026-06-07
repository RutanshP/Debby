"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  isCoachAssignmentSummary,
  withClassContext,
  type AssignmentRecipientDetail,
  type ClassListItem,
} from "@/lib/classroom";
import {
  classroomKeys,
  useClasses,
  useClassDetail,
  useQueryClient,
} from "@/lib/queries/classroom";
import { getBrowserSupabase } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  preserveClass?: boolean;
};

type ClassNavItem = {
  tab: "classwork" | "stream" | "people" | "results" | "analytics";
  label: string;
};

type ClassDialogMode = "create" | "join" | null;

const globalNavItems: NavItem[] = [
  { href: "/practice", label: "Practice", preserveClass: true },
  { href: "/drills", label: "Drills", preserveClass: true },
  { href: "/parli-gpt", label: "Case Studio", preserveClass: true },
  { href: "/progress", label: "Progress", preserveClass: true },
  { href: "/library", label: "Library", preserveClass: true },
  { href: "/calendar", label: "Calendar", preserveClass: true },
];

const competitorClassNavItems: ClassNavItem[] = [
  { tab: "classwork", label: "Assignments" },
  { tab: "stream", label: "Stream" },
  { tab: "people", label: "People" },
  { tab: "results", label: "Feedback" },
];

const coachClassNavItems: ClassNavItem[] = [
  { tab: "classwork", label: "Assignments" },
  { tab: "stream", label: "Stream" },
  { tab: "people", label: "People" },
  { tab: "results", label: "Feedback" },
  { tab: "analytics", label: "Analytics" },
];

const fieldClass =
  "h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function classAssignmentsDueCount(
  assignments: Array<{ recipient?: { status?: string } }> | undefined,
): number {
  return (assignments ?? []).filter(
    (item) => item.recipient?.status !== "completed",
  ).length;
}

function buildPathWithParams(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function roleLabel(role: ClassListItem["role"] | "coach" | "competitor"): string {
  return role === "coach" ? "Coach" : "Competitor";
}

function ClassDialog({
  mode,
  value,
  error,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: Exclude<ClassDialogMode, null>;
  value: string;
  error: string | null;
  submitting: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const isCreate = mode === "create";
  const title = isCreate ? "Create class" : "Join class";
  const label = isCreate ? "Class name" : "Enter class code";
  const placeholder = isCreate ? "Varsity PF" : "ABC123";
  const submitLabel = isCreate ? "Create class" : "Join";
  const pendingLabel = isCreate ? "Creating..." : "Joining...";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {label}
            <input
              value={value}
              onChange={(event) =>
                onChange(isCreate ? event.target.value : event.target.value.toUpperCase())
              }
              className={`${fieldClass} ${isCreate ? "" : "uppercase"}`}
              placeholder={placeholder}
              autoFocus
            />
          </label>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className={secondaryButtonClass}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass} disabled={submitting}>
              {submitting ? pendingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [classMenuOpen, setClassMenuOpen] = useState(false);
  const [classDialogMode, setClassDialogMode] = useState<ClassDialogMode>(null);
  const [newClassName, setNewClassName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [classDialogError, setClassDialogError] = useState<string | null>(null);
  const [submittingClassAction, setSubmittingClassAction] = useState(false);

  const classesQuery = useClasses();
  const classes = classesQuery.data ?? [];
  const requestedClassId = searchParams.get("class");
  const currentClassId = requestedClassId ?? classes[0]?.id ?? null;
  const classDetailQuery = useClassDetail(currentClassId);
  const classDetail = classDetailQuery.data;
  const currentClass =
    classes.find((item) => item.id === currentClassId) ??
    (currentClassId
      ? {
          id: currentClassId,
          name: classDetail?.class_room.name ?? "Class",
          role: classDetail?.role ?? "competitor",
          join_code: "",
          open_assignments: 0,
        }
      : null);

  const classAssignmentCount =
    classDetail?.role === "competitor"
      ? classAssignmentsDueCount(
          classDetail.assignments.filter(
            (item): item is AssignmentRecipientDetail =>
              !isCoachAssignmentSummary(item),
          ),
        )
      : 0;

  const activeClassTab = searchParams.get("tab") ?? "classwork";
  const hasClasses = classes.length > 0 && Boolean(currentClassId);
  const classNavItems =
    currentClass?.role === "coach" ? coachClassNavItems : competitorClassNavItems;

  const decoratedGlobalNav = useMemo(
    () =>
      globalNavItems.map((item) => ({
        ...item,
        href: item.preserveClass ? withClassContext(item.href, currentClassId) : item.href,
      })),
    [currentClassId],
  );

  function classTabHref(tab: ClassNavItem["tab"]): string {
    if (!currentClassId) return "/classes";
    return `/classes?class=${encodeURIComponent(currentClassId)}&tab=${tab}`;
  }

  function switchClass(nextClassId: string) {
    const params = new URLSearchParams(
      typeof searchParams?.toString === "function" ? searchParams.toString() : "",
    );
    params.set("class", nextClassId);
    params.set("tab", "classwork");
    router.push(buildPathWithParams("/classes", params));
    setClassMenuOpen(false);
  }

  function goPersonal() {
    setClassMenuOpen(false);
    router.push("/practice");
  }

  function openClassDialog(mode: Exclude<ClassDialogMode, null>) {
    setClassMenuOpen(false);
    setClassDialogMode(mode);
    setClassDialogError(null);
    if (mode === "create") {
      setNewClassName("");
    } else {
      setJoinCode("");
    }
  }

  function closeClassDialog() {
    setClassDialogMode(null);
    setClassDialogError(null);
    setSubmittingClassAction(false);
  }

  async function refreshClasses(): Promise<ClassListItem[]> {
    await queryClient.invalidateQueries({ queryKey: classroomKeys.list() });
    const rows = await apiFetch<ClassListItem[]>("/api/classes");
    queryClient.setQueryData(classroomKeys.list(), rows);
    return rows;
  }

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newClassName.trim()) return;
    setSubmittingClassAction(true);
    setClassDialogError(null);
    const previousIds = new Set(classes.map((item) => item.id));
    try {
      await apiFetch("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name: newClassName.trim() }),
      });
      const rows = await refreshClasses();
      const createdClass =
        rows.find((item) => !previousIds.has(item.id)) ?? rows[0] ?? null;
      closeClassDialog();
      if (createdClass) {
        router.push(`/classes?class=${encodeURIComponent(createdClass.id)}&tab=classwork`);
      }
    } catch (err) {
      setClassDialogError(
        err instanceof Error ? err.message : "Failed to create class",
      );
      setSubmittingClassAction(false);
    }
  }

  async function handleJoinClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!joinCode.trim()) return;
    setSubmittingClassAction(true);
    setClassDialogError(null);
    const previousIds = new Set(classes.map((item) => item.id));
    try {
      await apiFetch("/api/classes/join", {
        method: "POST",
        body: JSON.stringify({ join_code: joinCode.trim().toUpperCase() }),
      });
      const rows = await refreshClasses();
      const joinedClass =
        rows.find((item) => !previousIds.has(item.id)) ??
        rows.find((item) => item.join_code === joinCode.trim().toUpperCase()) ??
        rows[0] ??
        null;
      closeClassDialog();
      if (joinedClass) {
        router.push(`/classes?class=${encodeURIComponent(joinedClass.id)}&tab=classwork`);
      }
    } catch (err) {
      setClassDialogError(err instanceof Error ? err.message : "Failed to join class");
      setSubmittingClassAction(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = getBrowserSupabase();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col border-r border-slate-200 bg-white px-5 py-6 shadow-sm md:flex">
        <div className="flex flex-1 flex-col">
          <Link
            href={hasClasses && currentClassId ? classTabHref("classwork") : "/classes"}
            className="px-2 text-xl font-bold text-teal-dark"
          >
            Debby
          </Link>

          <nav className="mt-8 space-y-1" aria-label="Global navigation">
            {decoratedGlobalNav.map((item) => {
              const itemPath = item.href.split("?")[0];
              const active = isActive(pathname, itemPath);
              return (
                <Link
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-teal text-white"
                      : "text-slate-700 hover:bg-teal/10 hover:text-teal-dark"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 border-t border-slate-200 pt-6">
            <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Class
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setClassMenuOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold text-teal-dark transition hover:bg-teal/5"
                aria-expanded={classMenuOpen}
                aria-haspopup="listbox"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{currentClass?.name ?? "Classes"}</span>
                  {currentClass && (
                    <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-teal-dark">
                      {roleLabel(currentClass.role)}
                    </span>
                  )}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`h-4 w-4 transition ${classMenuOpen ? "rotate-180" : ""}`}
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {classMenuOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={goPersonal}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-teal-dark"
                  >
                    <span>Personal</span>
                  </button>
                  {classes.length > 0 && (
                    <>
                      <div className="my-2 border-t border-slate-100" />
                      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Classes
                      </div>
                      <div className="max-h-64 overflow-y-auto" role="listbox">
                        {classes.map((item) => {
                          const selected = item.id === currentClassId;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => switchClass(item.id)}
                              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                                selected
                                  ? "bg-teal/10 font-semibold text-teal-dark"
                                  : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate">{item.name}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                                  {roleLabel(item.role)}
                                </span>
                              </span>
                              <span className="flex items-center gap-2">
                                {item.role === "competitor" && item.open_assignments > 0 && (
                                  <span className="rounded-full bg-teal px-2 py-0.5 text-[11px] font-semibold text-white">
                                    {item.open_assignments}
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <div className="my-2 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => openClassDialog("create")}
                    className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-teal-dark"
                  >
                    + Create class
                  </button>
                  <button
                    type="button"
                    onClick={() => openClassDialog("join")}
                    className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-teal-dark"
                  >
                    + Join class
                  </button>
                </div>
              )}
            </div>

            {hasClasses && currentClass ? (
              <nav className="mt-3 space-y-1" aria-label="Selected class navigation">
                {classNavItems.map((item) => {
                  const active =
                    pathname === "/classes" && activeClassTab === item.tab;
                  return (
                    <Link
                      key={item.tab}
                      href={classTabHref(item.tab)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-teal text-white"
                          : "text-slate-700 hover:bg-teal/10 hover:text-teal-dark"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.label === "Assignments" && classAssignmentCount > 0 && (
                        <span
                          aria-label={`${classAssignmentCount} assignments due`}
                          className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            active ? "bg-white/20 text-white" : "bg-teal text-white"
                          }`}
                        >
                          {classAssignmentCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            ) : (
              <nav className="mt-3 space-y-1" aria-label="Class actions">
                <button
                  type="button"
                  onClick={() => openClassDialog("create")}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-teal/10 hover:text-teal-dark"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => openClassDialog("join")}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-teal/10 hover:text-teal-dark"
                >
                  Join
                </button>
              </nav>
            )}
          </div>
        </div>

        <div className="mt-auto space-y-2 border-t border-slate-200 pt-4">
          <Link
            href="/profile"
            className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
              isActive(pathname, "/profile")
                ? "bg-teal text-white"
                : "text-slate-700 hover:bg-teal/10 hover:text-teal-dark"
            }`}
          >
            Profile
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={hasClasses && currentClassId ? classTabHref("classwork") : "/classes"}
            className="font-bold text-teal-dark"
          >
            Debby
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>

        <nav className="mt-3 flex gap-2 overflow-x-auto" aria-label="Global navigation">
          {decoratedGlobalNav.map((item) => {
            const itemPath = item.href.split("?")[0];
            const active = isActive(pathname, itemPath);
            return (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                  active ? "bg-teal text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Class
          </div>
          <button
            type="button"
            onClick={() => setClassMenuOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-teal-dark"
            aria-expanded={classMenuOpen}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{currentClass?.name ?? "Classes"}</span>
              {currentClass && (
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-teal-dark">
                  {roleLabel(currentClass.role)}
                </span>
              )}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 transition ${classMenuOpen ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {classMenuOpen && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
              <button
                type="button"
                onClick={goPersonal}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-slate-700"
              >
                <span>Personal</span>
              </button>
              {classes.length > 0 && (
                <>
                  <div className="my-2 border-t border-slate-100" />
                  {classes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => switchClass(item.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
                      item.id === currentClassId
                        ? "bg-teal/10 font-semibold text-teal-dark"
                        : "text-slate-700"
                    }`}
                  >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{item.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                          {roleLabel(item.role)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {item.role === "competitor" && item.open_assignments > 0 && (
                          <span className="rounded-full bg-teal px-2 py-0.5 text-[11px] font-semibold text-white">
                            {item.open_assignments}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </>
              )}
              <div className="my-2 border-t border-slate-100" />
              <button
                type="button"
                onClick={() => openClassDialog("create")}
                className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700"
              >
                + Create class
              </button>
              <button
                type="button"
                onClick={() => openClassDialog("join")}
                className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700"
              >
                + Join class
              </button>
            </div>
          )}

          {hasClasses && currentClass ? (
            <nav className="mt-2 flex gap-2 overflow-x-auto" aria-label="Selected class navigation">
              {classNavItems.map((item) => {
                const active =
                  pathname === "/classes" && activeClassTab === item.tab;
                return (
                  <Link
                    key={item.tab}
                    href={classTabHref(item.tab)}
                    className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
                      active ? "bg-teal text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.label === "Assignments" && classAssignmentCount > 0 && (
                      <span
                        aria-label={`${classAssignmentCount} assignments due`}
                        className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                          active ? "bg-white/20 text-white" : "bg-teal text-white"
                        }`}
                      >
                        {classAssignmentCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <nav className="mt-2 flex gap-2 overflow-x-auto" aria-label="Class actions">
              <button
                type="button"
                onClick={() => openClassDialog("create")}
                className="shrink-0 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => openClassDialog("join")}
                className="shrink-0 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Join
              </button>
            </nav>
          )}
        </div>
      </header>

      <div className="md:pl-72">{children}</div>

      {classDialogMode && (
        <ClassDialog
          mode={classDialogMode}
          value={classDialogMode === "create" ? newClassName : joinCode}
          error={classDialogError}
          submitting={submittingClassAction}
          onChange={classDialogMode === "create" ? setNewClassName : setJoinCode}
          onClose={closeClassDialog}
          onSubmit={
            classDialogMode === "create" ? handleCreateClass : handleJoinClass
          }
        />
      )}
    </div>
  );
}
