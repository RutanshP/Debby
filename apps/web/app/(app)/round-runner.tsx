"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { getBrowserSupabase } from "../../lib/supabase";
import { RecordButton } from "../../components/RecordButton";
import { RfdCard } from "../../components/RfdCard";
import type { FlowSheetData } from "../../components/FlowSheet";
import { WpmChart, type WpmPoint } from "../../components/WpmChart";

type Format = "parli" | "mspdp";
type Side = "aff" | "neg";

interface TopicResponse {
  topic: string;
  side: Side;
  format: Format;
}

interface TournamentListResponse {
  tournaments: string[];
}

interface RoundResponse {
  id: string;
}

interface SpeechResponse {
  transcript: string;
  wpm_series: WpmPoint[];
}

interface AiSpeechResponse {
  speech: string;
}

interface JudgmentResponse {
  rfd: string;
  winner_side?: Side | null;
  flow: FlowSheetData;
}

type Step = 1 | 2 | 3 | 4 | 5;

const fieldLabelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const fieldControlClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-60";

const timerOptions = [
  { label: "30 sec", seconds: 30 },
  { label: "45 sec", seconds: 45 },
  { label: "1 min", seconds: 60 },
  { label: "1:30", seconds: 90 },
  { label: "2 min", seconds: 120 },
  { label: "3 min", seconds: 180 },
  { label: "4 min", seconds: 240 },
  { label: "5 min", seconds: 300 },
];

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function StepCard({
  step,
  title,
  active,
  done,
  children,
}: {
  step: number;
  title: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-current={active ? "step" : undefined}
      className={`rounded-lg border p-6 shadow-sm transition-colors ${
        active
          ? "border-teal bg-white"
          : done
            ? "border-slate-200 bg-slate-50"
            : "border-slate-200 bg-slate-50 opacity-60"
      }`}
    >
      <header className="mb-4 flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
            done
              ? "bg-teal text-white"
              : active
                ? "bg-teal/15 text-teal"
                : "bg-slate-200 text-slate-500"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function RoundRunner() {
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [format, setFormat] = useState<Format>("parli");
  const [tournament, setTournament] = useState<string>("");
  const [tournaments, setTournaments] = useState<string[]>([]);
  const [topic, setTopic] = useState<TopicResponse | null>(null);
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);

  // Step 2
  const [affTranscript, setAffTranscript] = useState<string | null>(null);
  const [affWpm, setAffWpm] = useState<WpmPoint[]>([]);
  const [affLoading, setAffLoading] = useState(false);

  // Step 3
  const [negTokens, setNegTokens] = useState("");
  const [negDone, setNegDone] = useState(false);
  const [negLoading, setNegLoading] = useState(false);
  const [negRequested, setNegRequested] = useState(false);
  const [negError, setNegError] = useState<string | null>(null);

  // Step 4
  const [affTwoTranscript, setAffTwoTranscript] = useState<string | null>(null);
  const [affTwoWpm, setAffTwoWpm] = useState<WpmPoint[]>([]);
  const [affTwoLoading, setAffTwoLoading] = useState(false);

  // Step 5
  const [judgment, setJudgment] = useState<JudgmentResponse | null>(null);
  const [judgmentLoading, setJudgmentLoading] = useState(false);
  const [judgmentRequested, setJudgmentRequested] = useState(false);
  const [judgmentError, setJudgmentError] = useState<string | null>(null);
  const [speechDurationSeconds, setSpeechDurationSeconds] = useState(120);

  const abortRef = useRef<AbortController | null>(null);
  const negStartedRef = useRef(false);
  const judgmentStartedRef = useRef(false);
  const negPromiseRef = useRef<Promise<string> | null>(null);
  const judgmentPromiseRef = useRef<Promise<JudgmentResponse> | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadTournaments() {
      try {
        const data = await apiFetch<TournamentListResponse>("/api/topics/tournaments");
        if (!ignore) setTournaments(data.tournaments);
      } catch {
        if (!ignore) setTournaments([]);
      }
    }

    loadTournaments();
    return () => {
      ignore = true;
    };
  }, []);

  const handleFormatChange = useCallback((nextFormat: Format) => {
    setFormat(nextFormat);
    setTopic(null);
    setTopicError(null);
    if (nextFormat !== "parli") setTournament("");
  }, []);

  const handleGetTopic = useCallback(async () => {
    setTopicError(null);
    setTopicLoading(true);
    try {
      const params = new URLSearchParams({ format });
      if (format === "parli" && tournament) params.set("tournament", tournament);
      const t = await apiFetch<TopicResponse>(`/api/topics?${params.toString()}`);
      setTopic(t);
    } catch (err) {
      setTopicError(err instanceof Error ? err.message : "Failed to load topic");
    } finally {
      setTopicLoading(false);
    }
  }, [format, tournament]);

  const handleAcceptTopic = useCallback(async () => {
    if (!topic) return;
    setTopicError(null);
    try {
      const round = await apiFetch<RoundResponse>("/api/rounds", {
        method: "POST",
        body: JSON.stringify({
          format: topic.format,
          topic: topic.topic,
          side: topic.side,
        }),
      });
      setRoundId(round.id);
      setStep(2);
      negStartedRef.current = false;
      judgmentStartedRef.current = false;
      negPromiseRef.current = null;
      judgmentPromiseRef.current = null;
      setNegTokens("");
      setNegDone(false);
      setNegRequested(false);
      setJudgment(null);
      setJudgmentRequested(false);
      setJudgmentError(null);
    } catch (err) {
      setTopicError(err instanceof Error ? err.message : "Failed to start round");
    }
  }, [topic]);

  const uploadSpeech = useCallback(
    async (blob: Blob, speechType: "aff" | "aff_two"): Promise<SpeechResponse> => {
      if (!roundId) throw new Error("No round id");
      const form = new FormData();
      form.append("audio", blob);
      form.append("speech_type", speechType);
      return apiFetch<SpeechResponse>(`/api/rounds/${roundId}/speeches`, {
        method: "POST",
        body: form,
      });
    },
    [roundId],
  );

  const handleAffComplete = useCallback(
    async (blob: Blob) => {
      setAffLoading(true);
      try {
        const res = await uploadSpeech(blob, "aff");
        setAffTranscript(res.transcript);
        setAffWpm(res.wpm_series ?? []);
        negStartedRef.current = false;
        negPromiseRef.current = null;
        setNegRequested(false);
        setStep(3);
      } finally {
        setAffLoading(false);
      }
    },
    [uploadSpeech],
  );

  const prefetchAiOpposition = useCallback(async (): Promise<string> => {
    if (!topic || !affTranscript) return "";
    if (negTokens.trim()) return negTokens;
    if (negPromiseRef.current) return negPromiseRef.current;

    setNegTokens("");
    setNegDone(false);
    setNegError(null);
    setNegLoading(true);
    const promise = apiFetch<AiSpeechResponse>("/api/ai/response", {
        method: "POST",
        body: JSON.stringify({ topic: topic.topic, first_speech: affTranscript }),
      })
      .then((res) => {
        setNegTokens(res.speech);
        setNegDone(true);
        return res.speech;
      })
      .catch((err) => {
        setNegError(err instanceof Error ? err.message : "Failed to generate opposition");
        throw err;
      })
      .finally(() => {
        setNegLoading(false);
        negPromiseRef.current = null;
      });

    negPromiseRef.current = promise;
    return promise;
  }, [topic, affTranscript, negTokens]);

  const revealAiOpposition = useCallback(async () => {
    setNegRequested(true);
    try {
      await prefetchAiOpposition();
    } catch {
      // Error text is already stored for the UI.
    }
  }, [prefetchAiOpposition]);

  const handleAffTwoComplete = useCallback(
    async (blob: Blob) => {
      setAffTwoLoading(true);
      try {
        const res = await uploadSpeech(blob, "aff_two");
        setAffTwoTranscript(res.transcript);
        setAffTwoWpm(res.wpm_series ?? []);
        judgmentStartedRef.current = false;
        judgmentPromiseRef.current = null;
        setJudgmentRequested(false);
        setStep(5);
      } finally {
        setAffTwoLoading(false);
      }
    },
    [uploadSpeech],
  );

  const prefetchJudgment = useCallback(async (): Promise<JudgmentResponse> => {
    if (!topic || !affTranscript || !affTwoTranscript) {
      throw new Error("Finish the speeches before judging.");
    }
    if (!negTokens.trim()) {
      throw new Error("Generate Debby's opposition speech before judging.");
    }
    if (judgment) return judgment;
    if (judgmentPromiseRef.current) return judgmentPromiseRef.current;

    setJudgmentError(null);
    judgmentStartedRef.current = true;
    setJudgmentLoading(true);
    const promise = apiFetch<JudgmentResponse>("/api/ai/judgment", {
        method: "POST",
        body: JSON.stringify({
          round_id: roundId,
          topic: topic.topic,
          aff_speech: affTranscript,
          neg_speech: negTokens,
          aff_two_speech: affTwoTranscript,
        }),
      })
      .then((res) => {
        setJudgment(res);
        return res;
      })
      .catch((err) => {
        setJudgmentError(
          err instanceof Error ? err.message : "Failed to fetch judgment",
        );
        throw err;
      })
      .finally(() => {
        setJudgmentLoading(false);
        judgmentPromiseRef.current = null;
      });

    judgmentPromiseRef.current = promise;
    return promise;
  }, [topic, affTranscript, affTwoTranscript, negTokens, judgment, roundId]);

  const revealJudgment = useCallback(async () => {
    setJudgmentRequested(true);
    try {
      await prefetchJudgment();
    } catch (err) {
      setJudgmentError(
        err instanceof Error ? err.message : "Failed to fetch judgment",
      );
    }
  }, [prefetchJudgment]);

  const handleJudgment = useCallback(async () => {
    await revealJudgment();
  }, [revealJudgment]);

  useEffect(() => {
    if (
      step === 3 &&
      topic &&
      affTranscript &&
      !negTokens.trim() &&
      !negLoading &&
      !negStartedRef.current
    ) {
      negStartedRef.current = true;
      void prefetchAiOpposition().catch(() => undefined);
    }
  }, [step, topic, affTranscript, negTokens, negLoading, prefetchAiOpposition]);

  useEffect(() => {
    if (
      step === 5 &&
      topic &&
      affTranscript &&
      affTwoTranscript &&
      negTokens.trim() &&
      !judgment &&
      !judgmentLoading &&
      !judgmentStartedRef.current
    ) {
      void prefetchJudgment().catch(() => undefined);
    }
  }, [
    step,
    topic,
    affTranscript,
    affTwoTranscript,
    negTokens,
    judgment,
    judgmentLoading,
    prefetchJudgment,
  ]);

  // ensure supabase module is referenced so build trees include it (auth bearer paths)
  void getBrowserSupabase;

  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Practice Round</h1>

      <StepCard step={1} title="Pick a topic" active={step === 1} done={step > 1}>
        <div className="flex flex-col gap-4">
          <label className={fieldLabelClass}>
            Format
            <select
              aria-label="Format"
              value={format}
              onChange={(e) => handleFormatChange(e.target.value as Format)}
              disabled={step > 1}
              className={fieldControlClass}
            >
              <option value="parli">Parli</option>
              <option value="mspdp">MSPDP</option>
            </select>
          </label>
          {format === "parli" && (
            <label className={fieldLabelClass}>
              Tournament
              <select
                aria-label="Tournament"
                value={tournament}
                onChange={(e) => setTournament(e.target.value)}
                disabled={step > 1}
                className={fieldControlClass}
              >
                <option value="">No Tournament</option>
                {tournaments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleGetTopic}
              disabled={topicLoading || step > 1}
              className={primaryButtonClass}
            >
            {topicLoading ? "Loading…" : "Get topic"}
            </button>
          </div>
          {topicError && <p className="text-sm text-red-600">{topicError}</p>}
          {topic && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">{topic.topic}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                Side: {topic.side} · {topic.format}
              </p>
              {step === 1 && (
                <button
                  type="button"
                  onClick={handleAcceptTopic}
                  className={`mt-3 ${primaryButtonClass}`}
                >
                  Accept topic
                </button>
              )}
            </div>
          )}
        </div>
      </StepCard>

      <StepCard step={2} title="Aff speech" active={step === 2} done={step > 2}>
        {step >= 2 ? (
          <div className="flex flex-col gap-3">
            <RecordButton
              onComplete={handleAffComplete}
              label="Record Aff speech"
              disabled={step !== 2 || affLoading}
              maxDurationSeconds={speechDurationSeconds}
            />
            {affLoading && <p className="text-sm text-slate-500">Uploading…</p>}
            {affTranscript && (
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                  Transcript
                </div>
                {affTranscript}
              </div>
            )}
            {affWpm.length > 0 && <WpmChart series={affWpm} />}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Complete step 1 first.</p>
        )}
      </StepCard>

      <StepCard
        step={3}
        title="AI opposition"
        active={step === 3}
        done={step > 3}
      >
        {step >= 3 ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={revealAiOpposition}
              disabled={step !== 3 || (negRequested && negLoading)}
              className={primaryButtonClass}
            >
              {negRequested && negLoading ? "Generating..." : "Generate response"}
            </button>
            {negError && <p className="text-sm text-red-600">{negError}</p>}
            {negRequested && negTokens && (
              <div
                data-testid="neg-tokens"
                className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700"
              >
                {negTokens}
              </div>
            )}
            {step === 3 && negRequested && negDone && negTokens.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setStep(4)}
                className={secondaryButtonClass}
              >
                Continue to rebuttal
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Complete the Aff speech first.</p>
        )}
      </StepCard>

      <StepCard step={4} title="Rebuttal" active={step === 4} done={step > 4}>
        {step >= 4 ? (
          <div className="flex flex-col gap-3">
            <RecordButton
              onComplete={handleAffTwoComplete}
              label="Record rebuttal"
              disabled={step !== 4 || affTwoLoading}
              maxDurationSeconds={speechDurationSeconds}
            />
            {affTwoLoading && <p className="text-sm text-slate-500">Uploading…</p>}
            {affTwoTranscript && (
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                  Transcript
                </div>
                {affTwoTranscript}
              </div>
            )}
            {affTwoWpm.length > 0 && <WpmChart series={affTwoWpm} />}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Finish AI opposition first.</p>
        )}
      </StepCard>

      <StepCard
        step={5}
        title="Judgment"
        active={step === 5}
        done={judgmentRequested && !!judgment}
      >
        {step >= 5 ? (
          <div className="flex flex-col gap-4">
            {!judgmentRequested && (
              <button
                type="button"
                onClick={handleJudgment}
                disabled={false}
                className={primaryButtonClass}
              >
                Judge debate
              </button>
            )}
            {judgmentRequested && !judgment && (
              <button
                type="button"
                disabled
                className={primaryButtonClass}
              >
                {judgmentLoading ? "Judging..." : "Judge debate"}
              </button>
            )}
            {judgmentError && (
              <p className="text-sm text-red-600">{judgmentError}</p>
            )}
            {judgmentRequested && judgment && (
              <>
                <RfdCard
                  rfd={judgment.rfd}
                  winnerSide={judgment.winner_side ?? null}
                />
                {roundId && (
                  <a
                    href={`/history/${roundId}`}
                    className="text-sm text-teal underline"
                  >
                    round saved as /history/{roundId}
                  </a>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Finish the rebuttal first.</p>
        )}
      </StepCard>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Timer
          </h2>
          {step === 1 ? (
            <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
              Speech length
              <select
                aria-label="Speech timer"
                value={speechDurationSeconds}
                onChange={(event) => setSpeechDurationSeconds(Number(event.target.value))}
                className={fieldControlClass}
              >
                {timerOptions.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="mt-4 text-sm font-medium text-slate-700">
              Speech length
            </div>
          )}
          <div className="mt-4 rounded-md bg-teal/10 p-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-dark">
              Max
            </div>
            <div className="mt-1 text-3xl font-bold text-teal-dark">
              {formatDuration(speechDurationSeconds)}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          WPM charts appear under each speech after transcription.
        </section>
      </aside>
    </main>
  );
}
