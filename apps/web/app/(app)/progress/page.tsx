import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { ProgressDashboard } from "./progress-dashboard";
import type { ProgressDrill, ProgressRound } from "@/lib/progress";
import type { SpeechInsightsResponse } from "@/lib/api";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function fetchJson<T>(path: string, token: string): Promise<T | undefined> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 204) return undefined;
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

interface ProgressSummaryResponse {
  rounds: ProgressRound[];
  drills: ProgressDrill[];
  insights: SpeechInsightsResponse | null;
}

export default async function ProgressPage() {
  const cookieStore = await Promise.resolve(cookies());
  const supabase = getServerSupabase(cookieStore);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-6 text-2xl font-semibold text-teal-dark">Progress</h1>
        <p className="text-sm text-slate-500">Sign in to see your progress.</p>
      </main>
    );
  }

  const summary = await fetchJson<ProgressSummaryResponse>(
    "/api/progress/summary?round_limit=100&drill_limit=100",
    session.access_token,
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-teal-dark">Progress</h1>
      {summary === undefined ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <h2 className="text-lg font-semibold text-slate-700">
            Progress could not load
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Refresh the page in a moment. The API may still be waking up.
          </p>
        </div>
      ) : (
        <ProgressDashboard
          rounds={summary.rounds}
          drills={summary.drills}
          initialInsights={summary?.insights ?? null}
        />
      )}
    </main>
  );
}
