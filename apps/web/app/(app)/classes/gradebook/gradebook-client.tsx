"use client";

import { useSearchParams } from "next/navigation";
import { useClassDetail } from "@/lib/queries/classroom";
import { GradebookDashboard } from "@/components/classroom/GradebookDashboard";

export function GradebookClient() {
  const searchParams = useSearchParams();
  const classId = searchParams.get("class");

  if (!classId) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          No class selected. Please select a class from the Assignments page.
        </div>
      </main>
    );
  }

  return <GradebookDashboard classId={classId} />;
}
