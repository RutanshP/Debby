import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { RfdCard } from "@/components/RfdCard";
import { WpmChart, type WpmPoint } from "@/components/WpmChart";
import { FlowSheet, type FlowSheetData } from "@/components/FlowSheet";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface Round {
  id: string;
  topic: string;
  format: string;
  side: "aff" | "neg" | null;
  rfd: string | null;
  winner_side: "aff" | "neg" | null;
  flow: FlowSheetData | null;
  wpm_series: WpmPoint[] | null;
  aff_speech: string | null;
  neg_speech: string | null;
  aff_two_speech: string | null;
  created_at: string;
}

interface PageProps {
  params: Promise<{ roundId: string }>;
}

function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-4 text-2xl font-semibold text-slate-800">History</h1>
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Round not found.
      </div>
    </main>
  );
}

export default async function HistoryDetailPage({ params }: PageProps) {
  const { roundId } = await params;

  const cookieStore = await Promise.resolve(cookies());
  const supabase = getServerSupabase(cookieStore);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return <NotFound />;

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

  const round = (await res.json()) as Round;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-teal-dark">{round.topic}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {round.format.toUpperCase()} &middot; {round.side ?? "?"} &middot;{" "}
          {new Date(round.created_at).toLocaleString()}
        </p>
      </header>

      {round.rfd && <RfdCard rfd={round.rfd} winnerSide={round.winner_side} />}

      {round.wpm_series && round.wpm_series.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">Speech pace</h2>
          <WpmChart series={round.wpm_series} />
        </section>
      )}

      {round.flow && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">Flow</h2>
          <FlowSheet flow={round.flow} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Transcripts</h2>
        {round.aff_speech && (
          <details className="rounded-md border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Affirmative speech
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {round.aff_speech}
            </p>
          </details>
        )}
        {round.neg_speech && (
          <details className="rounded-md border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              AI opposition speech
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {round.neg_speech}
            </p>
          </details>
        )}
        {round.aff_two_speech && (
          <details className="rounded-md border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Rebuttal
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {round.aff_two_speech}
            </p>
          </details>
        )}
      </section>
    </main>
  );
}
