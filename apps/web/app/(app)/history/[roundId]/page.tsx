import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { RfdCard } from "@/components/RfdCard";
import { WpmChart, type WpmPoint } from "@/components/WpmChart";
import { FlowSheet, type FlowSheetData } from "@/components/FlowSheet";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const SIDE_LABEL: Record<"aff" | "neg", string> = {
  aff: "Affirmative",
  neg: "Negative",
};

interface Round {
  id: string;
  topic: string;
  format: string;
  side: "aff" | "neg" | null;
  rfd: string | null;
  winner_side: "aff" | "neg" | null;
  flow: FlowSheetData | null;
  wpm_series: WpmPoint[] | { aff?: WpmPoint[]; aff_two?: WpmPoint[] } | null;
  speech_metrics: Record<
    string,
    {
      duration_seconds?: number | null;
      filler_count?: number | null;
      filler_words?: Record<string, number> | null;
      filler_per_minute?: number | null;
    }
  > | null;
  filler_count: number | null;
  filler_per_minute: number | null;
  first_speech_wpm: number | null;
  second_speech_wpm: number | null;
  average_wpm: number | null;
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

function winnerFromFlow(flow: FlowSheetData | null): "aff" | "neg" | null {
  const winner = typeof flow?.ballot === "object" ? flow.ballot.winner : null;
  return winner === "aff" || winner === "neg" ? winner : null;
}

function winnerLabel(
  winner: "aff" | "neg" | null,
  userSide: "aff" | "neg" | null,
): string | null {
  if (!winner) return null;
  const person = winner === userSide ? "You" : "Debby";
  return `${person} (${SIDE_LABEL[winner]})`;
}

function speechSeries(
  wpmSeries: Round["wpm_series"],
  speechType: "aff" | "aff_two",
): WpmPoint[] {
  if (Array.isArray(wpmSeries)) return speechType === "aff" ? wpmSeries : [];
  return wpmSeries?.[speechType] ?? [];
}

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">
        {value ?? "N/A"}
      </div>
    </div>
  );
}

function FillerSummary({
  metric,
}: {
  metric:
    | {
        filler_count?: number | null;
        filler_words?: Record<string, number> | null;
        filler_per_minute?: number | null;
      }
    | null
    | undefined;
}) {
  if (!metric) return null;
  const count = Number(metric.filler_count ?? 0);
  const perMinute = Number(metric.filler_per_minute ?? 0);
  const words = Object.entries(metric.filler_words ?? {})
    .filter(([, value]) => Number(value) > 0)
    .map(([word, value]) => `${word} (${value})`);

  return (
    <div className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-slate-700">
      <span className="font-semibold text-rose-700">Filler words: </span>
      {count} total · {perMinute.toFixed(1)}/min
      {words.length > 0 ? (
        <span className="text-slate-500"> · {words.join(", ")}</span>
      ) : null}
    </div>
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
  const winner = round.winner_side ?? winnerFromFlow(round.flow);

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-teal-dark">{round.topic}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {round.format.toUpperCase()} &middot; {round.side ?? "?"} &middot;{" "}
          {new Date(round.created_at).toLocaleString()}
        </p>
      </header>

      {round.rfd && (
        <RfdCard
          rfd={round.rfd}
          winnerSide={winner}
          winnerLabel={winnerLabel(winner, round.side)}
        />
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          Speech statistics
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="1st speech WPM" value={round.first_speech_wpm} />
          <StatCard label="2nd speech WPM" value={round.second_speech_wpm} />
          <StatCard label="Average WPM" value={round.average_wpm} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <StatCard label="Filler words" value={round.filler_count} />
          <StatCard
            label="Fillers/min"
            value={
              typeof round.filler_per_minute === "number"
                ? Math.round(round.filler_per_minute)
                : null
            }
          />
        </div>
      </section>

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
              {round.side === "aff" ? "Your" : "Debby's"} affirmative speech
            </summary>
            <div className="mt-4">
              <WpmChart series={speechSeries(round.wpm_series, "aff")} />
            </div>
            <FillerSummary metric={round.speech_metrics?.aff} />
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {round.aff_speech}
            </p>
          </details>
        )}
        {round.neg_speech && (
          <details className="rounded-md border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              {round.side === "neg" ? "Your" : "Debby's"} negative speech
            </summary>
            <FillerSummary metric={round.speech_metrics?.neg} />
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {round.neg_speech}
            </p>
          </details>
        )}
        {round.aff_two_speech && (
          <details className="rounded-md border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              {round.side === "aff" ? "Your" : "Debby's"} affirmative rebuttal
            </summary>
            <div className="mt-4">
              <WpmChart series={speechSeries(round.wpm_series, "aff_two")} />
            </div>
            <FillerSummary metric={round.speech_metrics?.aff_two} />
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {round.aff_two_speech}
            </p>
          </details>
        )}
      </section>
    </main>
  );
}
