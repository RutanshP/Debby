import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { RfdCard } from "@/components/RfdCard";
import { FlowSheet, type FlowSheetData } from "@/components/FlowSheet";
import { WpmChart, type WpmPoint } from "@/components/WpmChart";
import type { SubmissionFeedback } from "@/lib/feedback";
import type { SubmissionDetailResponse } from "@/lib/classSubmission";

const SIDE_LABEL: Record<"aff" | "neg", string> = {
  aff: "Affirmative",
  neg: "Negative",
};

const FILLER_PATTERNS = [
  "you know",
  "i mean",
  "sort of",
  "kind of",
  "so like",
  "and like",
  "but like",
  "like i",
  "like we",
  "like you",
  "like they",
  "basically",
  "um",
  "uh",
  "erm",
  "er",
  "ah",
  "hmm",
];

export function SubmissionNotFound({ back }: { back: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href={back}
        className="mb-4 inline-flex text-sm font-medium text-teal transition hover:text-teal-dark"
      >
        Back to classroom
      </Link>
      <div className="mt-4 rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Submission not found or you do not have access.
      </div>
    </main>
  );
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
        major_pause_count?: number | null;
      }
    | null
    | undefined;
}) {
  if (!metric) return null;
  const count = Number(metric.filler_count ?? 0);
  const pauses = Number(metric.major_pause_count ?? 0);
  const perMinute = Number(metric.filler_per_minute ?? 0);
  const words = Object.entries(metric.filler_words ?? {})
    .filter(([, value]) => Number(value) > 0)
    .map(([word, value]) => `${word} (${value})`);

  return (
    <div className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-slate-700">
      <span className="font-semibold text-rose-700">Filler words: </span>
      {count} total · {perMinute.toFixed(1)}/min
      <span className="text-slate-500"> · Major pauses: {pauses}</span>
      {words.length > 0 ? (
        <span className="text-slate-500"> · {words.join(", ")}</span>
      ) : null}
    </div>
  );
}

function HighlightedTranscript({ text }: { text: string }) {
  const escaped = FILLER_PATTERNS.map((pattern) =>
    pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  const parts: Array<{ text: string; filler: boolean }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), filler: false });
    }
    parts.push({ text: match[0], filler: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), filler: false });
  }

  return (
    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
      {parts.map((part, index) =>
        part.filler ? (
          <span key={index} className="font-semibold text-rose-700">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function speechSeries(
  wpmSeries: SubmissionDetailResponse["round"] extends null
    ? null
    : NonNullable<SubmissionDetailResponse["round"]>["wpm_series"],
  speechType: "aff" | "aff_two",
): WpmPoint[] {
  if (Array.isArray(wpmSeries)) return speechType === "aff" ? wpmSeries : [];
  if (!wpmSeries) return [];
  return (wpmSeries as Record<string, WpmPoint[]>)[speechType] ?? [];
}

function winnerLabel(
  winner: "aff" | "neg" | null,
  studentSide: "aff" | "neg" | null,
): string | null {
  if (!winner) return null;
  const who = winner === studentSide ? "Student" : "Debby";
  return `${who} (${SIDE_LABEL[winner]})`;
}

export function SubmissionDetailView({
  data,
  backHref,
  headingDetail,
  coachFeedback,
}: {
  data: SubmissionDetailResponse;
  backHref: string;
  headingDetail: string;
  coachFeedback?: SubmissionFeedback | null;
}) {
  const round = data.round;
  const drill = data.drill;
  const caseReview = data.case_review;
  const speedSeries = Array.isArray(drill?.wpm_series) ? drill.wpm_series : [];
  const originalSpeedPassage =
    drill?.drill_type === "speed" && typeof drill.prompt?.prompt === "string"
      ? drill.prompt.prompt
      : null;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header>
        <Link
          href={backHref}
          className="mb-4 inline-flex text-sm font-medium text-teal transition hover:text-teal-dark"
        >
          Back to results
        </Link>
        <h1 className="text-2xl font-semibold text-teal-dark">
          {data.assignment.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {data.assignment.type === "practice_round"
            ? "Practice round"
            : data.assignment.type === "case"
              ? "Case analysis"
              : "Drill"}{" "}
          · {headingDetail}
        </p>
      </header>

      {data.type === "round" && round && (
        <>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="mb-1 text-base font-semibold text-slate-800">Topic</h2>
            <p className="text-sm text-slate-700">{round.topic}</p>
            <p className="mt-1 text-xs text-slate-500">
              {round.format?.toUpperCase()} ·{" "}
              {round.side ? SIDE_LABEL[round.side] : "Unknown side"} ·{" "}
              {round.created_at ? new Date(round.created_at).toLocaleString() : ""}
            </p>
          </div>

          {round.rfd && (
            <RfdCard
              rfd={round.rfd}
              winnerSide={round.winner_side}
              winnerLabel={winnerLabel(round.winner_side, round.side)}
            />
          )}

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-800">
              Speech statistics
            </h2>
            {round.side === "neg" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard label="Speech WPM" value={round.average_wpm} />
                <StatCard label="Filler words" value={round.filler_count} />
                <StatCard label="Major pauses" value={round.major_pause_count} />
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard label="1st speech WPM" value={round.first_speech_wpm} />
                  <StatCard label="2nd speech WPM" value={round.second_speech_wpm} />
                  <StatCard label="Average WPM" value={round.average_wpm} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <StatCard label="Filler words" value={round.filler_count} />
                  <StatCard label="Major pauses" value={round.major_pause_count} />
                </div>
              </>
            )}
          </section>

          {round.flow && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-800">Flow</h2>
              <FlowSheet flow={round.flow as FlowSheetData} />
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800">Transcripts</h2>
            {round.aff_speech && (
              <details className="rounded-md border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  {round.side === "aff" ? "Student's" : "Debby's"} affirmative speech
                </summary>
                <div className="mt-4">
                  <WpmChart series={speechSeries(round.wpm_series, "aff")} />
                </div>
                <FillerSummary metric={round.speech_metrics?.aff} />
                <HighlightedTranscript text={round.aff_speech} />
              </details>
            )}
            {round.neg_speech && (
              <details className="rounded-md border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  {round.side === "neg" ? "Student's" : "Debby's"} negative speech
                </summary>
                <FillerSummary metric={round.speech_metrics?.neg} />
                <HighlightedTranscript text={round.neg_speech} />
              </details>
            )}
            {round.aff_two_speech && (
              <details className="rounded-md border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  {round.side === "aff" ? "Student's" : "Debby's"} affirmative rebuttal
                </summary>
                <div className="mt-4">
                  <WpmChart series={speechSeries(round.wpm_series, "aff_two")} />
                </div>
                <FillerSummary metric={round.speech_metrics?.aff_two} />
                <HighlightedTranscript text={round.aff_two_speech} />
              </details>
            )}
          </section>
        </>
      )}

      {data.type === "drill" && drill && (
        <>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="mb-1 text-base font-semibold text-slate-800">Drill type</h2>
            <p className="text-sm capitalize text-slate-700">{drill.drill_type}</p>
            {drill.created_at && (
              <p className="mt-1 text-xs text-slate-500">
                Completed {new Date(drill.created_at).toLocaleString()}
              </p>
            )}
          </div>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-800">Drill stats</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label="Score"
                value={
                  drill.numeric_score ??
                  (typeof (drill.score as Record<string, unknown> | null)?.score === "number"
                    ? ((drill.score as Record<string, unknown>).score as number)
                    : null)
                }
              />
              <StatCard label="WPM" value={drill.wpm} />
              <StatCard
                label="Duration (s)"
                value={
                  drill.duration_seconds !== null && drill.duration_seconds !== undefined
                    ? Math.round(drill.duration_seconds)
                    : null
                }
              />
            </div>
            {drill.accuracy !== null && drill.accuracy !== undefined && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <StatCard
                  label="Accuracy %"
                  value={Math.round((drill.accuracy ?? 0) * 100)}
                />
                <StatCard
                  label="Completion %"
                  value={Math.round((drill.completion ?? 0) * 100)}
                />
              </div>
            )}
          </section>

          {drill.drill_type === "speed" && speedSeries.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-800">
                WPM over time
              </h2>
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <WpmChart series={speedSeries} />
              </div>
            </section>
          )}

          {drill.drill_type === "speed" && originalSpeedPassage && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-800">
                Original passage
              </h2>
              <div className="rounded-md border border-slate-200 bg-white p-4">
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {originalSpeedPassage}
                </p>
              </div>
            </section>
          )}

          {drill.response && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-800">
                Student response
              </h2>
              <div className="rounded-md border border-slate-200 bg-white p-4">
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {drill.response}
                </p>
              </div>
            </section>
          )}
        </>
      )}

      {data.type === "case" && caseReview && (
        <>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="mb-1 text-base font-semibold text-slate-800">Rating</h2>
            <p className="text-sm text-slate-700">
              {caseReview.category} ({caseReview.score}/10)
            </p>
            <p className="mt-2 text-sm text-slate-600">{caseReview.summary}</p>
            {caseReview.created_at && (
              <p className="mt-1 text-xs text-slate-500">
                Submitted {new Date(caseReview.created_at).toLocaleString()}
              </p>
            )}
          </div>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-800">Feedback</h2>
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="text-sm text-slate-700">
                <ReactMarkdown>{caseReview.feedback}</ReactMarkdown>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-800">
              Submitted case
            </h2>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="mb-2 text-xs text-slate-500">
                {(caseReview.format ?? "").toUpperCase()} ·{" "}
                {caseReview.side ? SIDE_LABEL[caseReview.side] : "Unknown side"}
              </p>
              {caseReview.topic ? (
                <p className="mb-3 text-sm font-medium text-slate-800">
                  {caseReview.topic}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {caseReview.source_text}
              </p>
            </div>
          </section>
        </>
      )}

      {coachFeedback !== undefined && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">Coach feedback</h2>
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            {coachFeedback?.grade != null && (
              <p className="text-sm text-slate-700">
                <span className="font-medium">Grade:</span> {coachFeedback.grade}
              </p>
            )}
            {coachFeedback?.feedback ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                {coachFeedback.feedback}
              </p>
            ) : (
              <p className="text-sm text-slate-500">No feedback yet.</p>
            )}
          </div>
        </section>
      )}

      {!round && !drill && !caseReview && (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
          This student has not submitted their work yet.
        </div>
      )}
    </main>
  );
}
