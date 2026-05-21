import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { HistoryList, type HistoryRound } from "./history-list";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function fetchRounds(): Promise<HistoryRound[]> {
  const cookieStore = await Promise.resolve(cookies());
  const supabase = getServerSupabase(cookieStore);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/rounds?limit=50`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  return (await res.json()) as HistoryRound[];
}

export default async function HistoryPage() {
  const rounds = await fetchRounds();
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-teal-dark">History</h1>
      <HistoryList rounds={rounds} />
    </main>
  );
}
