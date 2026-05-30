import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { ProgressDashboard } from "./progress-dashboard";
import type { ProgressDrill, ProgressRound } from "@/lib/progress";
import type { SpeechInsightsResponse } from "@/lib/api";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function fetchJson<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 204) return null;
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
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

  const [rounds, drills, insights] = await Promise.all([
    fetchJson<ProgressRound[]>("/api/rounds/summary?limit=100", session.access_token),
    fetchJson<ProgressDrill[]>("/api/drills/summary?limit=100", session.access_token),
    fetchJson<SpeechInsightsResponse>("/api/insights", session.access_token),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-teal-dark">Progress</h1>
      <ProgressDashboard
        rounds={rounds ?? []}
        drills={drills ?? []}
        initialInsights={insights}
      />
    </main>
  );
}
