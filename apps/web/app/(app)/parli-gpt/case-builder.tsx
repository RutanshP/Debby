"use client";

import type React from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { apiFetch, ApiError } from "@/lib/api";

type Format = "parli" | "mspdp";
type Side = "aff" | "neg";

const TOPIC_WORD_LIMIT = 100;
const SAVED_CASE_TITLE_LIMIT = 240;

interface CaseResponse {
  case: string;
}

interface RandomCaseResponse {
  case: string;
  topic: string;
  side: Side;
}

interface SavedCaseResponse {
  id: string;
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

function filenamePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "case"
  );
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function truncateTitle(value: string): string {
  const title = value.trim();
  if (title.length <= SAVED_CASE_TITLE_LIMIT) return title;
  return `${title.slice(0, SAVED_CASE_TITLE_LIMIT - 3).trimEnd()}...`;
}

function titleFromGeneratedCase(markdown: string): string | null {
  const heading = markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,3}\s+(.+)$/)?.[1]?.trim())
    .find(Boolean);
  return heading ? truncateTitle(heading) : null;
}

export default function CaseBuilder() {
  const [format, setFormat] = useState<Format>("parli");
  const [topic, setTopic] = useState("");
  const [side, setSide] = useState<Side>("aff");
  const [caseText, setCaseText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const topicWordCount = countWords(topic);
  const topicTooLong = topicWordCount > TOPIC_WORD_LIMIT;

  async function handleGenerate() {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) return;
    if (topicTooLong) {
      setError(`Topics must be ${TOPIC_WORD_LIMIT} words or fewer.`);
      return;
    }
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    setSaveError(null);
    setSavedCaseId(null);
    setCaseText("");
    try {
      const data = await apiFetch<CaseResponse>("/api/cases", {
        method: "POST",
        body: JSON.stringify({ format, topic: trimmedTopic, side }),
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
    setSaveMessage(null);
    setSaveError(null);
    setSavedCaseId(null);
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

  async function handleSaveCase() {
    if (!caseText.trim() || savedCaseId) return;
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const title =
        titleFromGeneratedCase(caseText) ??
        truncateTitle(
          `${side === "aff" ? "Affirmative" : "Negative"} Case: ${topic.trim() || "Untitled topic"}`,
        );
      const saved = await apiFetch<SavedCaseResponse>("/api/saved-cases", {
        method: "POST",
        body: JSON.stringify({
          title,
          topic: topic.trim() || "Untitled topic",
          format,
          side,
          content: caseText,
        }),
      });
      setSavedCaseId(saved.id);
      setSaveMessage(`Saved to Library.`);
      window.history.replaceState(null, "", `/parli-gpt?saved=${saved.id}`);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to save case";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  function handlePrintPdf() {
    const originalTitle = document.title;
    document.title = `${filenamePart(topic)}-${side}`;
    const restoreTitle = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    window.print();
    window.setTimeout(restoreTitle, 1000);
  }

  return (
    <div className="case-builder-page mx-auto max-w-7xl px-4 py-8">
      <h1 className="case-builder-heading mb-6 text-3xl font-bold text-teal-700">
        Case Builder
      </h1>
      <div className="space-y-6">
        <section className="case-builder-controls rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[160px_1fr_180px_auto_auto] lg:items-start">
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
                className="h-10 w-full rounded border border-slate-300 px-2"
              >
                <option value="parli">Parli</option>
                <option value="mspdp">MSPDP</option>
              </select>
              <div className="mt-1 h-4 text-xs" aria-hidden="true" />
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
                className="h-10 w-full rounded border border-slate-300 px-2"
              />
              <div className="mt-1 flex justify-between text-xs">
                {topicTooLong ? (
                  <span className="text-red-600">
                    Topics must be {TOPIC_WORD_LIMIT} words or fewer.
                  </span>
                ) : (
                  <span className="text-slate-500">
                    {TOPIC_WORD_LIMIT - topicWordCount} words left
                  </span>
                )}
                <span className={topicTooLong ? "text-red-600" : "text-slate-400"}>
                  {topicWordCount}/{TOPIC_WORD_LIMIT}
                </span>
              </div>
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
                className="h-10 w-full rounded border border-slate-300 px-2"
              >
                <option value="aff">Affirmative</option>
                <option value="neg">Negation</option>
              </select>
              <div className="mt-1 h-4 text-xs" aria-hidden="true" />
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading || !topic.trim() || topicTooLong}
              className="h-10 rounded bg-teal-600 px-5 font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 lg:mt-6"
            >
              Generate
            </button>
            <button
              type="button"
              onClick={handleRandom}
              disabled={loading}
              className="h-10 rounded border border-teal-600 px-5 font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 lg:mt-6"
            >
              Random topic
            </button>
          </div>
        </section>

        <section className="case-builder-output min-h-[300px] rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
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
            <div>
              <div className="case-builder-actions mb-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={handleSaveCase}
                  disabled={saving || Boolean(savedCaseId)}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-teal-600 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savedCaseId ? "Saved to Library" : saving ? "Saving..." : "Save to Library"}
                </button>
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Save PDF
                </button>
              </div>
              {saveMessage ? (
                <p className="case-builder-actions mb-4 text-right text-sm font-medium text-teal-700">
                  {saveMessage}
                </p>
              ) : null}
              {saveError ? (
                <p className="case-builder-actions mb-4 text-right text-sm font-medium text-red-600">
                  {saveError}
                </p>
              ) : null}
              <article className="case-print-document">
                <ReactMarkdown components={markdownComponents}>
                  {caseText}
                </ReactMarkdown>
              </article>
            </div>
          )}
          {!loading && !error && !caseText && (
            <p className="text-slate-500">Debate Case</p>
          )}
        </section>
      </div>
    </div>
  );
}
