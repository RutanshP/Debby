"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { RecordButton } from "@/components/RecordButton";
import { WpmChart, type WpmPoint } from "@/components/WpmChart";
import type { RealtimeTranscriptResult } from "@/hooks/useRealtimeTranscription";

export type DrillType = "rebuttal" | "speed" | "impact" | "contention" | "filler";

interface DrillTypeOption {
  type: DrillType;
  label: string;
  description: string;
  mode: "Typing" | "Audio";
}

const DRILL_TYPES: DrillTypeOption[] = [
  {
    type: "rebuttal",
    label: "Rebuttal",
    description: "Answer a short opposing argument.",
    mode: "Audio",
  },
  {
    type: "speed",
    label: "Speed Reading",
    description: "Read a passage as quickly and clearly as possible.",
    mode: "Audio",
  },
  {
    type: "impact",
    label: "Impact Extension",
    description: "Turn an argument into full weighing.",
    mode: "Audio",
  },
  {
    type: "contention",
    label: "Contention Storm",
    description: "Generate as many taglines as possible.",
    mode: "Typing",
  },
  {
    type: "filler",
    label: "Filler Detection",
    description: "Speak freely until a filler word slips out.",
    mode: "Audio",
  },
];

const TIMER_OPTIONS = [30, 60, 120];
const FILLER_WORDS = new Set([
  "um",
  "uh",
  "erm",
  "er",
  "ah",
  "hmm",
  "like",
  "basically",
  "literally",
  "actually",
]);
const FILLER_PHRASES = ["you know", "i mean", "sort of", "kind of"];

interface DrillPrompt {
  id: string | number;
  drill_type: DrillType;
  prompt?: string | DrillPromptBody;
  passage?: string;
  topic?: string;
  title?: string;
}

interface DrillScore {
  score?: number;
  feedback?: string;
  strengths?: string[];
  improvements?: string[];
}

interface SpeedScore {
  score?: number;
  accuracy?: number;
  completion?: number;
  duration_seconds?: number;
  wpm?: number;
  wpm_series?: WpmPoint[];
  feedback?: string;
}

interface DrillPromptBody {
  title?: string;
  topic?: string;
  prompt?: string;
  task?: string;
  timer_seconds?: number;
}

function promptBody(drill: DrillPrompt): DrillPromptBody {
  return typeof drill.prompt === "object" && drill.prompt !== null
    ? (drill.prompt as DrillPromptBody)
    : {};
}

function drillTitle(drill: DrillPrompt): string {
  return promptBody(drill).title ?? drill.title ?? "Your Drill";
}

function drillTopic(drill: DrillPrompt): string | undefined {
  return promptBody(drill).topic ?? drill.topic;
}

function drillPromptText(drill: DrillPrompt): string | undefined {
  return (
    (typeof drill.prompt === "string" ? drill.prompt : promptBody(drill).prompt) ??
    drill.passage
  );
}

function drillTask(drill: DrillPrompt): string | undefined {
  return promptBody(drill).task;
}

function speedFeedbackLabel(wpm?: number, accuracy?: number): string {
  if (typeof wpm !== "number") return "Speed reading complete";
  if (wpm >= 220 && (accuracy ?? 1) >= 0.85) return "Fast and controlled";
  if (wpm >= 180) return "Solid pace";
  return "Keep building pace";
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, "");
}

function detectFiller(transcript: string): string | null {
  const words = transcript.split(/\s+/).map(normalizeToken).filter(Boolean);
  const compact = words.join(" ");
  for (const phrase of FILLER_PHRASES) {
    if (compact.includes(phrase)) return phrase;
  }
  return words.find((word) => FILLER_WORDS.has(word)) ?? null;
}

function FeedbackLoading() {
  return (
    <section
      aria-label="Feedback loading"
      role="status"
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal/30 border-t-teal" />
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Feedback</h2>
        <p className="text-sm text-slate-600">Scoring your drill...</p>
      </div>
    </section>
  );
}

export function DrillsClient() {
  const [drillType, setDrillType] = useState<DrillType>("rebuttal");
  const [timerSeconds, setTimerSeconds] = useState<number>(60);
  const [drill, setDrill] = useState<DrillPrompt | null>(null);
  const [response, setResponse] = useState("");
  const [score, setScore] = useState<DrillScore | null>(null);
  const [speedScore, setSpeedScore] = useState<SpeedScore | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [typingStarted, setTypingStarted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmittedRef = useRef(false);
  const detectedFillerRef = useRef<string | null>(null);
  const responseRef = useRef("");
  const submittingRef = useRef(false);
  const typingDeadlineRef = useRef<number | null>(null);

  const isSpeed = drillType === "speed";
  const isContention = drillType === "contention";
  const isFiller = drillType === "filler";
  const usesAudio = !isContention;
  const drillComplete = Boolean(score || speedScore);
  const typingTimerExpired =
    isContention && typingStarted && remainingSeconds !== null && remainingSeconds <= 0;

  useEffect(() => {
    responseRef.current = response;
  }, [response]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  function clearCurrentDrill() {
    setDrill(null);
    setResponse("");
    setScore(null);
    setSpeedScore(null);
    setRemainingSeconds(null);
    setTypingStarted(false);
    setError(null);
    autoSubmittedRef.current = false;
    detectedFillerRef.current = null;
    typingDeadlineRef.current = null;
  }

  function handleDrillTypeChange(nextType: DrillType) {
    setDrillType(nextType);
    clearCurrentDrill();
  }

  async function handleGenerate() {
    setError(null);
    setScore(null);
    setSpeedScore(null);
    setResponse("");
    setDrill(null);
    setRemainingSeconds(null);
    setTypingStarted(false);
    autoSubmittedRef.current = false;
    detectedFillerRef.current = null;
    typingDeadlineRef.current = null;
    setGenerating(true);
    try {
      const body: Record<string, unknown> = { drill_type: drillType };
      body.timer_seconds = isFiller ? 60 : timerSeconds;
      const data = await apiFetch<DrillPrompt>("/api/drills", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDrill(data);
      if (drillType === "contention") {
        setRemainingSeconds(null);
      } else {
        setRemainingSeconds(promptBody(data).timer_seconds ?? timerSeconds);
      }
      autoSubmittedRef.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate drill");
    } finally {
      setGenerating(false);
    }
  }

  const handleSubmitText = useCallback(async (responseOverride?: string) => {
    if (!drill) return;
    const responseText = responseOverride ?? responseRef.current;
    setError(null);
    setScore(null);
    setSpeedScore(null);
    setTypingStarted(false);
    setRemainingSeconds(null);
    typingDeadlineRef.current = null;
    setSubmitting(true);
    try {
      const data = await apiFetch<DrillScore>(
        `/api/drills/${drill.id}/score`,
        {
          method: "POST",
          body: JSON.stringify({ response: responseText }),
        },
      );
      setScore(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score drill");
    } finally {
      setSubmitting(false);
    }
  }, [drill]);

  useEffect(() => {
    if (!isContention || !drill || !typingStarted || drillComplete) return;

    const updateRemaining = () => {
      const deadline = typingDeadlineRef.current;
      if (deadline === null) return 0;
      const next = Math.max(Math.ceil((deadline - Date.now()) / 1000), 0);
      setRemainingSeconds(next);
      return next;
    };

    const submitIfExpired = () => {
      const responseText = responseRef.current;
      if (responseText.trim() && !submittingRef.current && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        void handleSubmitText(responseText);
      }
    };

    if (updateRemaining() <= 0) {
      submitIfExpired();
      return;
    }

    const timer = window.setInterval(() => {
      const next = updateRemaining();
      if (next <= 0) {
        submitIfExpired();
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [
    isContention,
    drill,
    typingStarted,
    drillComplete,
    handleSubmitText,
  ]);

  function handleStartTyping() {
    if (!drill || submitting) return;
    const duration = promptBody(drill).timer_seconds ?? timerSeconds;
    typingDeadlineRef.current = Date.now() + duration * 1000;
    autoSubmittedRef.current = false;
    setRemainingSeconds(duration);
    setTypingStarted(true);
  }

  async function handleSubmitSpeed(blob: Blob) {
    if (!drill) return;
    setError(null);
    setScore(null);
    setSpeedScore(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      const data = await apiFetch<SpeedScore>(
        `/api/drills/${drill.id}/score-speed`,
        { method: "POST", body: form },
      );
      setSpeedScore(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score speed drill");
    } finally {
      setSubmitting(false);
    }
  }

  function handleFillerTranscript(result: RealtimeTranscriptResult) {
    const filler = detectFiller(result.transcript);
    if (filler) {
      detectedFillerRef.current = filler;
    }
  }

  function shouldStopFiller(result: RealtimeTranscriptResult): boolean {
    const filler = detectFiller(result.transcript);
    if (!filler) return false;
    detectedFillerRef.current = filler;
    return true;
  }

  async function handleSubmitFiller(
    _blob: Blob,
    realtimeResult?: RealtimeTranscriptResult | null,
  ) {
    if (!drill) return;
    setError(null);
    setScore(null);
    setSpeedScore(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<DrillScore>(
        `/api/drills/${drill.id}/score-filler`,
        {
          method: "POST",
          body: JSON.stringify({
            transcript: realtimeResult?.transcript ?? "",
            duration_seconds: realtimeResult?.durationSeconds ?? 0,
            filler_word:
              detectedFillerRef.current ??
              detectFiller(realtimeResult?.transcript ?? ""),
          }),
        },
      );
      setScore(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score filler drill");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitAudio(blob: Blob) {
    if (!drill) return;
    setError(null);
    setScore(null);
    setSpeedScore(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      const data = await apiFetch<DrillScore>(
        `/api/drills/${drill.id}/score-audio`,
        { method: "POST", body: form },
      );
      setScore(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score audio");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-3xl font-bold text-teal-dark">Drills</h1>
        <p className="text-slate-600">
          Target one debate skill at a time, then get tight feedback.
        </p>
      </header>

      <section aria-label="Drill types" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {DRILL_TYPES.map((option) => {
          const active = option.type === drillType;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => handleDrillTypeChange(option.type)}
              aria-pressed={active}
              className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                active
                  ? "border-teal bg-teal/5 ring-2 ring-teal"
                  : "border-slate-200 bg-white hover:border-teal/60"
              }`}
            >
              <span className="inline-block w-fit rounded-full bg-teal/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-teal-dark">
                {option.mode}
              </span>
              <span className="text-lg font-semibold text-slate-900">{option.label}</span>
              <span className="text-sm text-slate-600">{option.description}</span>
            </button>
          );
        })}
      </section>

      {!drill && (
        <div className="flex w-fit items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <label htmlFor="timer" className="text-sm font-semibold text-teal-dark">
            Timer
          </label>
          <select
            id="timer"
            value={timerSeconds}
            onChange={(e) => setTimerSeconds(Number(e.target.value))}
            disabled={isFiller}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20"
          >
            {TIMER_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} sec
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate Drill"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {drill && (
        <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {drillTitle(drill)}
            </h2>
            {drillTopic(drill) && (
              <p className="text-sm text-slate-500">{drillTopic(drill)}</p>
            )}
          </div>
          {drillPromptText(drill) && (
            <p
              data-testid={isSpeed ? "speed-passage" : undefined}
              className="whitespace-pre-wrap text-slate-800"
            >
              {drillPromptText(drill)}
            </p>
          )}
          {drillTask(drill) && (
            <p className="text-sm font-medium text-slate-600">{drillTask(drill)}</p>
          )}
          {isContention && typingStarted && remainingSeconds !== null && !drillComplete && (
            <div className="w-fit rounded-md bg-teal/10 px-4 py-2 text-sm font-semibold text-teal-dark">
              Time left: {remainingSeconds}s
            </div>
          )}

          {drillComplete ? (
            <div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? "Generating..." : "Redo Drill"}
              </button>
            </div>
          ) : usesAudio ? (
            <div>
              <RecordButton
                onComplete={
                  isSpeed
                    ? handleSubmitSpeed
                    : isFiller
                      ? handleSubmitFiller
                      : handleSubmitAudio
                }
                label={
                  isSpeed
                    ? "Record Reading"
                    : isFiller
                      ? "Start Filler Drill"
                      : "Record Response"
                }
                disabled={submitting}
                maxDurationSeconds={isFiller ? 60 : timerSeconds}
                realtimeTranscription={isFiller}
                onRealtimeTranscript={isFiller ? handleFillerTranscript : undefined}
                stopWhenRealtimeTranscript={isFiller ? shouldStopFiller : undefined}
              />
            </div>
          ) : !typingStarted ? (
            <div>
              <button
                type="button"
                onClick={handleStartTyping}
                disabled={submitting}
                className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                Start Typing
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Your response goes here..."
                rows={6}
                disabled={typingTimerExpired}
                className="w-full rounded-md border border-slate-300 p-3 text-sm focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
              />
              {typingTimerExpired && (
                <p className="text-sm font-medium text-amber-700">
                  Time is up. Submit what you have.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleSubmitText()}
                  disabled={submitting || !response.trim()}
                  className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Scoring…" : "Submit Response"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {submitting && !score && !speedScore && <FeedbackLoading />}

      {score && (
        <section
          aria-label="Drill feedback"
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-xl font-semibold text-slate-900">Feedback</h2>
          {typeof score.score === "number" && (
            <p className="text-3xl font-bold text-teal-dark">{score.score}/10</p>
          )}
          {score.feedback && (
            <p className="whitespace-pre-wrap text-slate-800">{score.feedback}</p>
          )}
          {score.strengths && score.strengths.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Strengths</h3>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {score.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {score.improvements && score.improvements.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Improvements</h3>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {score.improvements.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {speedScore && (
        <section
          aria-label="Speed drill result"
          className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col items-start gap-2">
            <h2 className="text-2xl font-bold text-teal-dark">Feedback</h2>
            {typeof speedScore.score === "number" && (
              <p className="text-3xl font-bold text-teal-dark">
                {speedScore.score}/10
              </p>
            )}
            {typeof speedScore.wpm === "number" && (
              <div className="rounded-full bg-teal/10 px-3 py-1 text-sm font-bold text-teal-dark">
                {Math.round(speedScore.wpm)} WPM
              </div>
            )}
          </div>
          <div className="space-y-3 text-slate-700">
            <p className="text-lg font-bold text-teal-dark">
              {speedScore.feedback ??
                speedFeedbackLabel(speedScore.wpm, speedScore.accuracy)}
            </p>
            <div className="space-y-1">
              {typeof speedScore.accuracy === "number" && (
                <p>
                  <span className="font-bold text-teal-dark">Accuracy:</span>{" "}
                  {Math.round(speedScore.accuracy * 100)}% of attempted words
                </p>
              )}
              {typeof speedScore.completion === "number" && (
                <p>
                  <span className="font-bold text-teal-dark">Completion:</span>{" "}
                  {Math.round(speedScore.completion * 100)}% of the passage
                </p>
              )}
              {typeof speedScore.duration_seconds === "number" && (
                <p>
                  <span className="font-bold text-teal-dark">Duration:</span>{" "}
                  {Math.round(speedScore.duration_seconds)}s
                </p>
              )}
            </div>
          </div>
          {speedScore.wpm_series && speedScore.wpm_series.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-teal/5 p-3">
              <h3 className="mb-2 text-sm font-bold text-slate-900">WPM over time</h3>
              <WpmChart series={speedScore.wpm_series} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
