import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { LibraryTabs, type LibraryTab } from "./library-tabs";
import { HistoryList, type HistoryRound } from "./rounds-list";
import { SavedCasesList, type SavedCaseSummary } from "./saved-cases-list";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const PAGE_SIZE = 20;

interface PageProps {
  searchParams?: Promise<{ tab?: string }>;
}

async function authToken(): Promise<string | null> {
  const cookieStore = await Promise.resolve(cookies());
  const supabase = getServerSupabase(cookieStore);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function fetchRounds(token: string): Promise<HistoryRound[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/rounds/summary?limit=${PAGE_SIZE}&offset=0`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as HistoryRound[];
  } catch {
    return [];
  }
}

async function fetchSavedCases(token: string): Promise<SavedCaseSummary[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/saved-cases?limit=${PAGE_SIZE}&offset=0`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as SavedCaseSummary[];
  } catch {
    return [];
  }
}

export default async function LibraryPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const active: LibraryTab = params.tab === "cases" ? "cases" : "rounds";
  const token = await authToken();
  const rows = token
    ? active === "cases"
      ? await fetchSavedCases(token)
      : await fetchRounds(token)
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold text-teal-dark">Library</h1>
      <p className="mb-6 text-sm text-slate-500">
        Review previous rounds and saved Case Builder outputs.
      </p>
      <LibraryTabs active={active} />
      {active === "cases" ? (
        <SavedCasesList cases={rows as SavedCaseSummary[]} pageSize={PAGE_SIZE} />
      ) : (
        <HistoryList rounds={rows as HistoryRound[]} pageSize={PAGE_SIZE} />
      )}
    </main>
  );
}
