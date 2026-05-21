"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompletion } from "ai/react";
import { apiFetch, apiStreamUrl } from "../../lib/api";
import { getBrowserSupabase } from "../../lib/supabase";
import { RecordButton } from "../../components/RecordButton";
import { RfdCard } from "../../components/RfdCard";
import { FlowSheet, type FlowSheetData } from "../../components/FlowSheet";
import { WpmChart, type WpmPoint } from "../../components/WpmChart";

type Format = "parli" | "mspdp";
type Side = "aff" | "neg";

interface TopicResponse {
  topic: string;
  side: Side;
  format: Format;
}

interface RoundResponse {
  id: string;
}

interface SpeechResponse {
  transcript: string;
  wpm_series: WpmPoint[];
}

interface JudgmentResponse {
  rfd: string;
  winner_side?: Side | null;
  flow: FlowSheetData;
}

type Step = 1 | 2 | 3 | 4 | 5;

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

  // Step 4
  const [affTwoTranscript, setAffTwoTranscript] = useState<string | null>(null);
  const [affTwoWpm, setAffTwoWpm] = useState<WpmPoint[]>([]);
  const [affTwoLoading, setAffTwoLoading] = useState(false);

  // Step 5
  const [judgment, setJudgment] = useState<JudgmentResponse | null>(null);
  const [judgmentLoading, setJudgmentLoading] = useState(false);
  const [judgmentError, setJudgmentError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const { complete, completion } = useCompletion({
    api: apiStreamUrl("/api/ai/response-stream"),
  });

  // Mirror useCompletion output into local tokens; allows tests to assert as well.
  useEffect(() => {
    if (completion) setNegTokens(completion);
  }, [completion]);

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
        setStep(3);
      } finally {
        setAffLoading(false);
      }
    },
    [uploadSpeech],
  );

  const startAiOpposition = useCallback(async () => {
    if (!topic || !affTranscript) return;
    setNegTokens("");
    setNegDone(false);
    try {
      await complete("", {
        body: { topic: topic.topic, first_speech: affTranscript },
      });
      setNegDone(true);
    } catch {
      // useCompletion exposes its own error state; we still allow user to advance manually
      setNegDone(true);
    }
  }, [complete, topic, affTranscript]);

  const handleAffTwoComplete = useCallback(
    async (blob: Blob) => {
      setAffTwoLoading(true);
      try {
        const res = await uploadSpeech(blob, "aff_two");
        setAffTwoTranscript(res.transcript);
        setAffTwoWpm(res.wpm_series ?? []);
        setStep(5);
      } finally {
        setAffTwoLoading(false);
      }
    },
    [uploadSpeech],
  );

  const handleJudgment = useCallback(async () => {
    if (!topic || !affTranscript || !affTwoTranscript) return;
    setJudgmentError(null);
    setJudgmentLoading(true);
    try {
      const res = await apiFetch<JudgmentResponse>("/api/ai/judgment", {
        method: "POST",
        body: JSON.stringify({
          topic: topic.topic,
          aff_speech: affTranscript,
          neg_speech: negTokens,
          aff_two_speech: affTwoTranscript,
        }),
      });
      setJudgment(res);
    } catch (err) {
      setJudgmentError(
        err instanceof Error ? err.message : "Failed to fetch judgment",
      );
    } finally {
      setJudgmentLoading(false);
    }
  }, [topic, affTranscript, affTwoTranscript, negTokens]);

  // ensure supabase module is referenced so build trees include it (auth bearer paths)
  void getBrowserSupabase;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Practice Round</h1>

      <StepCard step={1} title="Pick a topic" active={step === 1} done={step > 1}>
        <div className="flex flex-col gap-3">
          <label className="text-sm text-slate-700">
            Format
            <select
              aria-label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              disabled={step > 1}
              className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="parli">Parli</option>
              <option value="mspdp">MSPDP</option>
            </select>
          </label>
          {format === "parli" && (
            <label className="text-sm text-slate-700">
              Tournament (optional)
              <input
                aria-label="Tournament"
                type="text"
                value={tournament}
                onChange={(e) => setTournament(e.target.value)}
                disabled={step > 1}
                className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
          )}
          <button
            type="button"
            onClick={handleGetTopic}
            disabled={topicLoading || step > 1}
            className="self-start rounded-md bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {topicLoading ? "Loading…" : "Get topic"}
          </button>
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
                  className="mt-3 rounded-md bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark"
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
              onClick={startAiOpposition}
              disabled={step !== 3 || negTokens.length > 0}
              className="self-start rounded-md bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dark disabled:opacity-60"
            >
              Generate opposition
            </button>
            {negTokens && (
              <div
                data-testid="neg-tokens"
                className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700"
              >
                {negTokens}
              </div>
            )}
            {step === 3 && (negDone || negTokens.length > 0) && (
              <button
                type="button"
                onClick={() => setStep(4)}
                className="self-start rounded-md border border-teal px-3 py-1.5 text-xs font-medium text-teal"
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

      <StepCard step={5} title="Judgment" active={step === 5} done={!!judgment}>
        {step >= 5 ? (
          <div className="flex flex-col gap-4">
            {!judgment && (
              <button
                type="button"
                onClick={handleJudgment}
                disabled={judgmentLoading}
                className="self-start rounded-md bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dark disabled:opacity-60"
              >
                {judgmentLoading ? "Judging…" : "Get judgment"}
              </button>
            )}
            {judgmentError && (
              <p className="text-sm text-red-600">{judgmentError}</p>
            )}
            {judgment && (
              <>
                <RfdCard
                  rfd={judgment.rfd}
                  winnerSide={judgment.winner_side ?? null}
                />
                <FlowSheet flow={judgment.flow} />
                {affWpm.length > 0 && <WpmChart series={affWpm} />}
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
    </main>
  );
}
