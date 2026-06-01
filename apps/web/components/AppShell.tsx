"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";

const navItems = [
  { href: "/", label: "Practice" },
  { href: "/drills", label: "Drills" },
  { href: "/parli-gpt", label: "Case Builder" },
  { href: "/progress", label: "Progress" },
  { href: "/library", label: "Library" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const inClassroom = pathname.startsWith("/classes");

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
            href={inClassroom ? "/workspace" : "/"}
            className="block px-2 text-xl font-bold text-teal-dark"
          >
            {inClassroom ? "Debby Classroom" : "Debby"}
          </Link>
          {inClassroom ? (
            <div className="mt-8 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-600">
              Classwork, people, and results live in this classroom.
            </div>
          ) : (
            <nav className="mt-8 space-y-1" aria-label="Main navigation">
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
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
          )}
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
          <div className="font-bold text-teal-dark">
            {inClassroom ? "Debby Classroom" : "Debby"}
          </div>
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
          {!inClassroom &&
            navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
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
