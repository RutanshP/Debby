"use client";

import type React from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { apiFetch, ApiError } from "@/lib/api";

type Format = "parli" | "mspdp";
type Side = "aff" | "neg";

interface CaseResponse {
  case: string;
}

interface RandomCaseResponse {
  case: string;
  topic: string;
  side: Side;
}

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-4 text-2xl font-bold text-teal-800">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-3 mt-6 text-xl font-semibold text-teal-700">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold text-slate-800">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 leading-7 text-slate-700">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-4 list-disc space-y-2 pl-6 text-slate-700">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-4 list-decimal space-y-2 pl-6 text-slate-700">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-7">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
};

export default function CaseBuilder() {
  const [format, setFormat] = useState<Format>("parli");
  const [topic, setTopic] = useState("");
  const [side, setSide] = useState<Side>("aff");
  const [caseText, setCaseText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setCaseText("");
    try {
      const data = await apiFetch<CaseResponse>("/api/cases", {
        method: "POST",
        body: JSON.stringify({ format, topic, side }),
      });
      setCaseText(data.case);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to generate case";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleRandom() {
    setLoading(true);
    setError(null);
    setCaseText("");
    try {
      const data = await apiFetch<RandomCaseResponse>("/api/cases/random", {
        method: "POST",
        body: JSON.stringify({ format }),
      });
      setTopic(data.topic);
      setSide(data.side);
      setCaseText(data.case);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to fetch random case";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold text-teal-700">Case Builder</h1>
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <label
              htmlFor="format"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Format
            </label>
            <select
              id="format"
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            >
              <option value="parli">Parli</option>
              <option value="mspdp">MSPDP</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="topic"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Topic
            </label>
            <input
              id="topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a topic..."
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            />
          </div>

          <div>
            <label
              htmlFor="side"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Side
            </label>
            <select
              id="side"
              value={side}
              onChange={(e) => setSide(e.target.value as Side)}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            >
              <option value="aff">Affirmative</option>
              <option value="neg">Negation</option>
            </select>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading || !topic.trim()}
              className="rounded bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate
            </button>
            <button
              type="button"
              onClick={handleRandom}
              disabled={loading}
              className="rounded border border-teal-600 px-4 py-2 font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Random topic
            </button>
          </div>
        </aside>

        <section className="min-h-[300px] rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {loading && (
            <div
              role="status"
              aria-label="Loading"
              className="flex items-center gap-2 text-slate-600"
            >
              <span
                className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent"
                aria-hidden="true"
              />
              <span>Generating case...</span>
            </div>
          )}
          {error && !loading && (
            <div role="alert" className="text-red-600">
              {error}
            </div>
          )}
          {!loading && !error && caseText && (
            <article>
              <ReactMarkdown components={markdownComponents}>
                {caseText}
              </ReactMarkdown>
            </article>
          )}
          {!loading && !error && !caseText && (
            <p className="text-slate-500">Debate Case</p>
          )}
        </section>
      </div>
    </div>
  );
}
