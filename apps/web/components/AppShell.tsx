"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Practice" },
  { href: "/drills", label: "Drills" },
  { href: "/classes", label: "Classes" },
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white px-4 py-6 shadow-sm md:block">
        <Link href="/" className="block px-2 text-xl font-bold text-teal-dark">
          Debby
        </Link>
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
      </aside>

      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:hidden">
        <div className="font-bold text-teal-dark">Debby</div>
        <nav className="mt-3 flex gap-2 overflow-x-auto" aria-label="Main navigation">
          {navItems.map((item) => {
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
