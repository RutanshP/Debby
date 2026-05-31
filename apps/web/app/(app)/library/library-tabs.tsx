import Link from "next/link";

export type LibraryTab = "rounds" | "cases";

export function LibraryTabs({ active }: { active: LibraryTab }) {
  const tabs: Array<{ value: LibraryTab; label: string; href: string }> = [
    { value: "rounds", label: "Rounds", href: "/library?tab=rounds" },
    { value: "cases", label: "Saved cases", href: "/library?tab=cases" },
  ];

  return (
    <div className="mb-6 flex gap-2 border-b border-slate-200">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            active === tab.value
              ? "border-teal text-teal-dark"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
