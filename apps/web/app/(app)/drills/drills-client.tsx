"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { RecordButton } from "@/components/RecordButton";
import { WpmChart, type WpmPoint } from "@/components/WpmChart";

export type DrillType = "rebuttal" | "speed" | "impact" | "contention";

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
    mode: "Typing",
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
    mode: "Typing",
  },
  {
    type: "contention",
    label: "Contention Storm",
    description: "Generate as many taglines as possible.",
    mode: "Typing",
  },
];

const SPEED_TIMER_OPTIONS = [30, 60, 120];

interface DrillPrompt {
  id: string | number;
  drill_type: DrillType;
  prompt?: string;
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
  accuracy?: number;
  wpm?: number;
  wpm_series?: WpmPoint[];
  feedback?: string;
}

export function DrillsClient() {
  const [drillType, setDrillType] = useState<DrillType>("rebuttal");
  const [timerSeconds, setTimerSeconds] = useState<number>(60);
  const [drill, setDrill] = useState<DrillPrompt | null>(null);
  const [response, setResponse] = useState("");
  const [score, setScore] = useState<DrillScore | null>(null);
  const [speedScore, setSpeedScore] = useState<SpeedScore | null>(null);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSpeed = drillType === "speed";

  async function handleGenerate() {
    setError(null);
    setScore(null);
    setSpeedScore(null);
    setResponse("");
    setGenerating(true);
    try {
      const body: Record<string, unknown> = { drill_type: drillType };
      if (isSpeed) body.timer_seconds = timerSeconds;
      const data = await apiFetch<DrillPrompt>("/api/drills", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDrill(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate drill");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmitText() {
    if (!drill) return;
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<DrillScore>(
        `/api/drills/${drill.id}/score`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        },
      );
      setScore(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score drill");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitSpeed(blob: Blob) {
    if (!drill) return;
    setError(null);
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

  async function handleSubmitAudio(blob: Blob) {
    if (!drill) return;
    setError(null);
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

      <section aria-label="Drill types" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DRILL_TYPES.map((option) => {
          const active = option.type === drillType;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => setDrillType(option.type)}
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

      {isSpeed && (
        <div className="flex items-center gap-3">
          <label htmlFor="timer" className="text-sm font-medium text-slate-700">
            Timer
          </label>
          <select
            id="timer"
            value={timerSeconds}
            onChange={(e) => setTimerSeconds(Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            {SPEED_TIMER_OPTIONS.map((s) => (
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
              {drill.title ?? "Your Drill"}
            </h2>
            {drill.topic && <p className="text-sm text-slate-500">{drill.topic}</p>}
          </div>
          {drill.prompt && (
            <p className="whitespace-pre-wrap text-slate-800">{drill.prompt}</p>
          )}
          {isSpeed && drill.passage && (
            <div
              data-testid="speed-passage"
              className="whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-slate-800"
            >
              {drill.passage}
            </div>
          )}

          {isSpeed ? (
            <div>
              <RecordButton onComplete={handleSubmitSpeed} label="Record Reading" disabled={submitting} />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Your response goes here..."
                rows={6}
                className="w-full rounded-md border border-slate-300 p-3 text-sm focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSubmitText}
                  disabled={submitting || !response.trim()}
                  className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Scoring…" : "Submit Response"}
                </button>
                <RecordButton
                  onComplete={handleSubmitAudio}
                  label="Score by Audio"
                  disabled={submitting}
                />
              </div>
            </div>
          )}
        </section>
      )}

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
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-xl font-semibold text-slate-900">Speed Result</h2>
          <div className="flex gap-6">
            {typeof speedScore.accuracy === "number" && (
              <div>
                <p className="text-xs uppercase text-slate-500">Accuracy</p>
                <p className="text-2xl font-bold text-teal-dark">
                  {Math.round(speedScore.accuracy * 100)}%
                </p>
              </div>
            )}
            {typeof speedScore.wpm === "number" && (
              <div>
                <p className="text-xs uppercase text-slate-500">WPM</p>
                <p className="text-2xl font-bold text-teal-dark">
                  {Math.round(speedScore.wpm)}
                </p>
              </div>
            )}
          </div>
          {speedScore.feedback && (
            <p className="whitespace-pre-wrap text-slate-800">{speedScore.feedback}</p>
          )}
          {speedScore.wpm_series && speedScore.wpm_series.length > 0 && (
            <WpmChart series={speedScore.wpm_series} />
          )}
        </section>
      )}
    </main>
  );
}
