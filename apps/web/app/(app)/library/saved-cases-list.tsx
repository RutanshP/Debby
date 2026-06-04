"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { withClassContext } from "@/lib/classroom";

export interface SavedCaseSummary {
  id: string;
  title: string;
  topic: string;
  format: "parli" | "mspdp";
  side: "aff" | "neg";
  created_at: string | null;
}

interface SavedCasesListProps {
  cases: SavedCaseSummary[];
  pageSize?: number;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sideLabel(side: "aff" | "neg"): string {
  return side === "aff" ? "Affirmative" : "Negative";
}

export function SavedCasesList({ cases, pageSize = 20 }: SavedCasesListProps) {
  const searchParams = useSearchParams();
  const classId = searchParams.get("class");
  const [items, setItems] = useState(cases);
  const [offset, setOffset] = useState(cases.length);
  const [hasMore, setHasMore] = useState(cases.length >= pageSize);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadMore() {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await apiFetch<SavedCaseSummary[]>(
        `/api/saved-cases?limit=${pageSize}&offset=${offset}`,
      );
      setItems((current) => [...current, ...next]);
      setOffset((current) => current + next.length);
      setHasMore(next.length === pageSize);
    } catch {
      setLoadError("Could not load more cases. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <h2 className="text-lg font-semibold text-slate-700">No saved cases yet</h2>
        <p className="mt-2 text-sm text-slate-500">
          Save a generated case from Case Builder and it will appear here.
        </p>
        <Link
          href={withClassContext("/parli-gpt", classId)}
          className="mt-5 inline-flex rounded-md bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dark"
        >
          Open Case Builder
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={withClassContext(`/library/cases/${item.id}`, classId)}
              className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal/50 hover:shadow"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">
                    {formatDate(item.created_at)}
                  </div>
                  <h3 className="mt-1 truncate text-base font-semibold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-1 truncate text-sm text-slate-600">
                    {item.topic}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-teal/10 px-3 py-1 text-xs font-medium text-teal">
                  {item.format.toUpperCase()} &middot; {sideLabel(item.side)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal/50 hover:text-teal disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
