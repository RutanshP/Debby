"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { withClassContext } from "@/lib/classroom";

function filenamePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "case"
  );
}

export function SavedCaseActions({
  id,
  topic,
  side,
}: {
  id: string;
  topic: string;
  side: "aff" | "neg";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const classId = searchParams.get("class");
  const [deleting, setDeleting] = useState(false);

  function printPdf() {
    const originalTitle = document.title;
    document.title = `${filenamePart(topic)}-${side}`;
    const restoreTitle = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    window.print();
    window.setTimeout(restoreTitle, 1000);
  }

  async function deleteCase() {
    setDeleting(true);
    try {
      await apiFetch<void>(`/api/saved-cases/${id}`, { method: "DELETE" });
      router.push(withClassContext("/library?tab=cases", classId));
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="case-builder-actions flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={printPdf}
        className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
      >
        Save PDF
      </button>
      <button
        type="button"
        onClick={deleteCase}
        disabled={deleting}
        className="rounded border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
