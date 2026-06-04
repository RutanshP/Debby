"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ClassRole } from "@/lib/classroom";
import { getBrowserSupabase } from "@/lib/supabase";
import { useClassDetail } from "@/lib/queries/classroom";

const navItems = [
  { href: "/practice", label: "Practice" },
  { href: "/drills", label: "Drills" },
  { href: "/parli-gpt", label: "Case Builder" },
  { href: "/progress", label: "Progress" },
  { href: "/library", label: "Library" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const classId = searchParams.get("class");
  const inClassWorkspace = pathname.startsWith("/classes") || Boolean(classId);

  // Use the query hook to get class detail (which includes the role)
  const classDetailQuery = useClassDetail(classId);
  const classRole = classDetailQuery.data?.role ?? null;
  // Determine if we're in a loading/transition state where role is unknown
  const roleUnknown = classId && classDetailQuery.isFetching;

  const coachNavItems = classId
    ? [
        { href: `/classes?class=${classId}&tab=classwork`, label: "Assignments" },
        { href: `/classes?class=${classId}&tab=people`, label: "People" },
        { href: `/classes?class=${classId}&tab=stream`, label: "Stream" },
        { href: `/classes?class=${classId}&tab=calendar`, label: "Calendar" },
        { href: `/classes?class=${classId}&tab=results`, label: "Results" },
        { href: `/classes?class=${classId}&tab=progress`, label: "Progress" },
        { href: `/classes/gradebook?class=${classId}`, label: "Gradebook" },
      ]
    : [{ href: "/classes", label: "Assignments" }];
  const studentNavItems = [
    { href: classId ? `/classes?class=${classId}` : "/classes", label: "Assignments" },
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
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
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
        </div>
        <div className="mt-auto space-y-1">
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
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
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
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                  active ? "bg-teal text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="md:pl-64">{children}</div>
    </div>
  );
}
