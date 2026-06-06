"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ClassRole } from "@/lib/classroom";
import { getBrowserSupabase } from "@/lib/supabase";
import { useClassDetail, useClasses } from "@/lib/queries/classroom";

const navItems = [
  { href: "/practice", label: "Practice" },
  { href: "/drills", label: "Drills" },
  { href: "/parli-gpt", label: "Case Studio" },
  { href: "/progress", label: "Progress" },
  { href: "/library", label: "Library" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function assignmentBadgeCount({
  classId,
  classRole,
  detailAssignments,
  classList,
}: {
  classId: string | null;
  classRole: ClassRole | null;
  detailAssignments?: Array<{ recipient?: { status: string } }> | null;
  classList?: Array<{ id: string; open_assignments: number }> | null;
}): number {
  if (classRole === "coach") return 0;
  if (classId && detailAssignments) {
    return detailAssignments.filter((item) => item.recipient?.status !== "completed").length;
  }
  return (classList ?? []).reduce((sum, item) => sum + (item.open_assignments ?? 0), 0);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const classId = searchParams.get("class");
  const inClassWorkspace = pathname.startsWith("/classes") || Boolean(classId);
  const classesQuery = useClasses();

  // Use the query hook to get class detail (which includes the role)
  const classDetailQuery = useClassDetail(classId);
  const classRole = classDetailQuery.data?.role ?? null;
  const dueAssignments = assignmentBadgeCount({
    classId,
    classRole,
    detailAssignments:
      classDetailQuery.data?.role === "competitor"
        ? classDetailQuery.data.assignments
        : null,
    classList: classesQuery.data ?? null,
  });
  // Role is "unknown" only while the detail for this class is loading for the
  // first time (no cached data yet). Using isLoading rather than isFetching
  // avoids collapsing the nav on every background refetch, while still
  // preventing a stale coach/student flash when switching to a new class.
  const roleUnknown = Boolean(classId) && classDetailQuery.isLoading;

  const coachNavItems = classId
    ? [
        { href: `/classes?class=${classId}&tab=classwork`, label: "Assignments" },
        { href: `/classes?class=${classId}&tab=people`, label: "People" },
        { href: `/classes?class=${classId}&tab=stream`, label: "Stream" },
        { href: `/classes?class=${classId}&tab=calendar`, label: "Calendar" },
        { href: `/classes?class=${classId}&tab=results`, label: "Gradebook" },
        { href: `/classes?class=${classId}&tab=progress`, label: "Progress" },
      ]
    : [{ href: "/classes", label: "Assignments" }];
  const studentNavItems = [
    {
      href: classId ? `/classes?class=${classId}&tab=stream` : "/classes?tab=stream",
      label: "Assignments",
    },
    ...navItems.map((item) => ({
      ...item,
      href: classId
        ? `${item.href}?class=${classId}`
        : item.href,
    })),
  ];
  const scopedNavItems = inClassWorkspace
    ? roleUnknown
      ? [{ href: `/classes?class=${classId}`, label: "Assignments" }]
      : classRole === "coach"
        ? coachNavItems
        : classRole === "competitor" || !classId
          ? studentNavItems
          : [{ href: `/classes?class=${classId}`, label: "Assignments" }]
    : navItems;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = getBrowserSupabase();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      // Ensure signingOut resets even if an error occurs
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-6 shadow-sm md:flex">
        <div>
          <Link
            href={inClassWorkspace ? "/workspace" : "/practice"}
            className="block px-2 text-xl font-bold text-teal-dark"
          >
            Debby
          </Link>
          <nav className="mt-8 space-y-1" aria-label="Main navigation">
            {scopedNavItems.map((item) => {
              const itemPath = item.href.split("?")[0];
              const itemTab = new URLSearchParams(item.href.split("?")[1] ?? "").get("tab");
              const currentTab = searchParams.get("tab") ?? "classwork";
              const active =
                classRole === "coach" && itemTab
                  ? pathname.startsWith("/classes") && currentTab === itemTab
                  : item.label === "Assignments"
                  ? pathname.startsWith("/classes")
                  : isActive(pathname, itemPath);
              return (
                <Link
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-teal text-white"
                      : "text-slate-700 hover:bg-teal/10 hover:text-teal-dark"
                  }`}
                >
                  <span>{item.label}</span>
                  {item.label === "Assignments" && dueAssignments > 0 && (
                    <span
                      aria-label={`${dueAssignments} assignments due`}
                      className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        active ? "bg-white/20 text-white" : "bg-teal text-white"
                      }`}
                    >
                      {dueAssignments}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
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
          <Link
            href="/workspace"
            className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
              isActive(pathname, "/workspace")
                ? "bg-teal text-white"
                : "text-slate-700 hover:bg-teal/10 hover:text-teal-dark"
            }`}
          >
            Switch workspace
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
          <div className="font-bold text-teal-dark">Debby</div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto" aria-label="Main navigation">
          <Link
            href="/workspace"
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
              isActive(pathname, "/workspace")
                ? "bg-teal text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            Workspace
          </Link>
          {scopedNavItems.map((item) => {
            const itemPath = item.href.split("?")[0];
            const itemTab = new URLSearchParams(item.href.split("?")[1] ?? "").get("tab");
            const currentTab = searchParams.get("tab") ?? "classwork";
            const active =
              classRole === "coach" && itemTab
                ? pathname.startsWith("/classes") && currentTab === itemTab
                : item.label === "Assignments"
                ? pathname.startsWith("/classes")
                : isActive(pathname, itemPath);
            return (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
                  active ? "bg-teal text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <span>{item.label}</span>
                {item.label === "Assignments" && dueAssignments > 0 && (
                  <span
                    aria-label={`${dueAssignments} assignments due`}
                    className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                      active ? "bg-white/20 text-white" : "bg-teal text-white"
                    }`}
                  >
                    {dueAssignments}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="md:pl-64">{children}</div>
    </div>
  );
}
