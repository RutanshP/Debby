import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import type { FlowSheetData } from "@/components/FlowSheet";
import FlowView from "./flow-view";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface RoundResponse {
  id: string;
  flow?: FlowSheetData | null;
}

interface PageProps {
  params: Promise<{ roundId: string }>;
}

function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-4 text-2xl font-semibold text-slate-800">Flowbot</h1>
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Round not found.
      </div>
    </main>
  );
}

export default async function FlowbotRoundPage({ params }: PageProps) {
  const { roundId } = await params;

  const cookieStore = await Promise.resolve(cookies());
  const supabase = getServerSupabase(cookieStore);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return <NotFound />;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/rounds/${roundId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
  } catch {
    return <NotFound />;
  }

  if (res.status === 404 || res.status === 401 || res.status === 403) {
    return <NotFound />;
  }
  if (!res.ok) {
    throw new Error(`Failed to load round: ${res.status}`);
  }

  const round = (await res.json()) as RoundResponse;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-teal-700">Flow</h1>
      <FlowView flow={round.flow ?? null} />
    </main>
  );
}
