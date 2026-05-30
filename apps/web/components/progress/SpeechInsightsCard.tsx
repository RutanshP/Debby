"use client";

import { useEffect, useState } from "react";
import { getInsights, refreshInsights, type SpeechInsightsResponse } from "@/lib/api";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SpeechInsightsCard({
  initial,
}: {
  initial: SpeechInsightsResponse | null;
}) {
  const [data, setData] = useState<SpeechInsightsResponse | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;

    let cancelled = false;

    async function loadCachedInsights() {
      setLoading(true);
      setError(null);
      try {
        const cached = await getInsights();
        if (!cancelled) {
          setData(cached);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load insights.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCachedInsights();

    return () => {
      cancelled = true;
    };
  }, [initial]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await refreshInsights();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-slate-500">
          {data
            ? `${data.rounds_covered} rounds analyzed · updated ${relativeTime(data.generated_at)}`
            : loading
              ? "Loading insights..."
              : "Not generated yet."}
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex h-9 items-center justify-center rounded-md border border-teal px-3 text-xs font-medium text-teal transition hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Loading..." : data ? "Refresh insights" : "Generate insights"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {data ? (
        <div className="space-y-4">
          <p className="text-base font-medium text-slate-900">{data.summary.headline}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Strengths
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                {data.summary.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recurring issues
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                {data.summary.recurring_issues.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="rounded-md bg-teal/5 p-3 text-sm text-slate-700">
            <span className="font-semibold text-teal-dark">Focus next: </span>
            {data.summary.suggested_focus}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Click <span className="font-medium text-slate-700">Generate insights</span> to have
          Debby summarize patterns across your recent speeches.
        </p>
      )}
    </div>
  );
}
