"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  isCoachAssignmentSummary,
  withClassContext,
  type AssignmentRecipientDetail,
} from "@/lib/classroom";
import { useClasses, useClassDetail } from "@/lib/queries/classroom";
import { getBrowserSupabase } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  preserveClass?: boolean;
};

type ClassNavItem = {
  tab: "classwork" | "stream" | "people" | "results";
  label: string;
};

type ClassActionItem = {
  tab: "create" | "join";
  label: string;
};

const globalNavItems: NavItem[] = [
  { href: "/practice", label: "Practice", preserveClass: true },
  { href: "/drills", label: "Drills", preserveClass: true },
  { href: "/parli-gpt", label: "Case Studio", preserveClass: true },
  { href: "/progress", label: "Progress", preserveClass: true },
  { href: "/library", label: "Library", preserveClass: true },
  { href: "/calendar", label: "Calendar", preserveClass: true },
];

const classNavItems: ClassNavItem[] = [
  { tab: "classwork", label: "Assignments" },
  { tab: "stream", label: "Stream" },
  { tab: "people", label: "People" },
  { tab: "results", label: "Feedback" },
];

const classActionItems: ClassActionItem[] = [
  { tab: "create", label: "Create" },
  { tab: "join", label: "Join" },
];

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [classMenuOpen, setClassMenuOpen] = useState(false);

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

  function classActionHref(tab: ClassActionItem["tab"]): string {
    return `/classes?tab=${tab}`;
  }

  function switchClass(nextClassId: string) {
    const params = new URLSearchParams(
      typeof searchParams?.toString === "function" ? searchParams.toString() : "",
    );
    params.set("class", nextClassId);
    if (pathname === "/classes" && !params.get("tab")) {
      params.set("tab", "classwork");
    }
    router.push(buildPathWithParams(pathname, params));
    setClassMenuOpen(false);
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
                <span>{currentClass?.name ?? "Classes"}</span>
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
                  <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {hasClasses ? "Switch class" : "Classes"}
                  </div>
                  {hasClasses ? (
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
                            <span>{item.name}</span>
                            {item.role === "competitor" && item.open_assignments > 0 && (
                              <span className="rounded-full bg-teal px-2 py-0.5 text-[11px] font-semibold text-white">
                                {item.open_assignments}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3 py-2 text-sm text-slate-500">
                      No classes yet.
                    </div>
                  )}
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    {classActionItems.map((item) => (
                      <Link
                        key={item.tab}
                        href={classActionHref(item.tab)}
                        onClick={() => setClassMenuOpen(false)}
                        className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-teal-dark"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
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
                {classActionItems.map((item) => {
                  const active =
                    pathname === "/classes" && activeClassTab === item.tab;
                  return (
                    <Link
                      key={item.tab}
                      href={classActionHref(item.tab)}
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
            <span>{currentClass?.name ?? "Classes"}</span>
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
              {hasClasses ? (
                <>
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
                      <span>{item.name}</span>
                      {item.role === "competitor" && item.open_assignments > 0 && (
                        <span className="rounded-full bg-teal px-2 py-0.5 text-[11px] font-semibold text-white">
                          {item.open_assignments}
                        </span>
                      )}
                    </button>
                  ))}
                </>
              ) : (
                <div className="px-3 py-2 text-sm text-slate-500">No classes yet.</div>
              )}
              <div className="mt-2 border-t border-slate-100 pt-2">
                {classActionItems.map((item) => (
                  <Link
                    key={item.tab}
                    href={classActionHref(item.tab)}
                    onClick={() => setClassMenuOpen(false)}
                    className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
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
              {classActionItems.map((item) => {
                const active =
                  pathname === "/classes" && activeClassTab === item.tab;
                return (
                  <Link
                    key={item.tab}
                    href={classActionHref(item.tab)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                      active ? "bg-teal text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </header>

      <div className="md:pl-72">{children}</div>
    </div>
  );
}
