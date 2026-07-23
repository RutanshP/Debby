"use client";

import type React from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { apiFetch, ApiError } from "@/lib/api";
import {
  isCoachAssignmentSummary,
  isCasePayload,
  statusLabel,
  type AssignmentRecipientDetail,
} from "@/lib/classroom";
import { useClassDetail } from "@/lib/queries/classroom";

type Format = "parli" | "mspdp";
type Side = "aff" | "neg";
type StudioMode = "create" | "analyze";

const TOPIC_WORD_LIMIT = 100;
const SAVED_CASE_TITLE_LIMIT = 240;
const ANALYSIS_WORD_LIMIT = 6000;

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

interface AnalyzeCaseResponse {
  score: number;
  category: string;
  summary: string;
  feedback: string;
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

function indentationWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function looksStructured(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|[A-Za-z]\d+[:.) -]|(Contention|Uniqueness|Link|Links|Impact|Impacts|Claim|Warrant|Reasoning|Evidence|Solvency|Overview|Framework|Observation)(\s*[:.-]|\s*$))/i.test(
    trimmed,
  );
}

function normalizeCaseStructure(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const indents = Array.from(
    new Set(
      lines
        .filter((line) => line.trim())
        .map(indentationWidth)
        .filter((width) => width > 0),
    ),
  ).sort((a, b) => a - b);

  const levelForIndent = (width: number) => {
    if (width <= 0) return 0;
    const found = indents.findIndex((candidate) => width <= candidate);
    return (found === -1 ? indents.length : found + 1);
  };

  return lines
    .map((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return "";

      const content = trimmed.trimStart();
      const level = levelForIndent(indentationWidth(trimmed));
      if (level === 0 || looksStructured(content)) {
        return content;
      }
      return `${"  ".repeat(Math.max(level - 1, 0))}- ${content}`;
    })
    .join("\n");
}

function normalizeComparableTopic(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

type CaseAssignmentDetail = AssignmentRecipientDetail & {
  assignment: AssignmentRecipientDetail["assignment"] & {
    payload: {
      format: Format;
      topic: string;
      side: Side;
    };
  };
};

export default function CaseBuilder() {
  const searchParams = useSearchParams();
  const classId = searchParams.get("class");
  const assignmentRecipientId = searchParams.get("assignment");
  const classDetailQuery = useClassDetail(classId);
  const [mode, setMode] = useState<StudioMode>("create");
  const [format, setFormat] = useState<Format>("parli");
  const [topic, setTopic] = useState("");
  const [side, setSide] = useState<Side>("aff");
  const [inputCaseText, setInputCaseText] = useState("");
  const [assignmentCaseText, setAssignmentCaseText] = useState("");
  const [caseText, setCaseText] = useState("");
  const [analysis, setAnalysis] = useState<AnalyzeCaseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [assignmentDetail, setAssignmentDetail] =
    useState<AssignmentRecipientDetail | null>(null);
  const [assignmentCompleted, setAssignmentCompleted] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const topicWordCount = countWords(topic);
  const topicTooLong = topicWordCount > TOPIC_WORD_LIMIT;
  const analysisWordCount = countWords(inputCaseText);
  const analysisTooLong = analysisWordCount > ANALYSIS_WORD_LIMIT;
  const assignmentWordCount = countWords(assignmentCaseText);
  const assignmentTooLong = assignmentWordCount > ANALYSIS_WORD_LIMIT;
  const assignmentLocked = Boolean(assignmentDetail && isCasePayload(assignmentDetail.assignment));
  const classCaseAssignments =
    !assignmentRecipientId && classDetailQuery.data?.role === "competitor"
      ? classDetailQuery.data.assignments.filter(
          (item): item is CaseAssignmentDetail =>
            !isCoachAssignmentSummary(item) &&
            item.recipient.status !== "completed" &&
            isCasePayload(item.assignment),
        )
      : [];
  const matchingClassCaseAssignments = classCaseAssignments.filter((item) => {
    const payload = item.assignment.payload;
    return (
      payload.format === format &&
      payload.side === side &&
      normalizeComparableTopic(payload.topic) === normalizeComparableTopic(topic)
    );
  });

  function resetOutput() {
    setError(null);
    setSaveMessage(null);
    setSaveError(null);
    setSavedCaseId(null);
    setCaseText("");
    setAnalysis(null);
  }

  function handleModeChange(nextMode: StudioMode) {
    if (assignmentLocked) return;
    setMode(nextMode);
    resetOutput();
  }

  useEffect(() => {
    let ignore = false;
    async function loadAssignment() {
      if (!assignmentRecipientId) {
        setAssignmentDetail(null);
        setAssignmentCompleted(false);
        return;
      }
      setAssignmentLoading(true);
      setError(null);
      try {
        const detail = await apiFetch<AssignmentRecipientDetail>(
          `/api/assignments/${assignmentRecipientId}`,
        );
        if (ignore) return;
        if (!isCasePayload(detail.assignment)) {
          throw new Error("This assignment is not a case analysis.");
        }
        setAssignmentDetail(detail);
        setAssignmentCompleted(detail.recipient.status === "completed");
        setMode("create");
        setFormat(detail.assignment.payload.format);
        setTopic(detail.assignment.payload.topic);
        setSide(detail.assignment.payload.side);
        setInputCaseText("");
        setAssignmentCaseText("");
        resetOutput();
        if (
          detail.result &&
          typeof detail.result.score === "number" &&
          typeof detail.result.category === "string" &&
          typeof detail.result.summary === "string" &&
          typeof detail.result.feedback === "string"
        ) {
          const previous = {
            score: detail.result.score,
            category: detail.result.category,
            summary: detail.result.summary,
            feedback: detail.result.feedback,
          } as AnalyzeCaseResponse;
          setAnalysis(previous);
          if (typeof detail.result.source_text === "string") {
            setAssignmentCaseText(detail.result.source_text);
          }
        } else {
          setCaseText("");
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load assignment");
        }
      } finally {
        if (!ignore) setAssignmentLoading(false);
      }
    }
    void loadAssignment();
    return () => {
      ignore = true;
    };
  }, [assignmentRecipientId]);

  async function handleGenerate() {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) return;
    if (topicTooLong) {
      setError(`Topics must be ${TOPIC_WORD_LIMIT} words or fewer.`);
      return;
    }
    setLoading(true);
    resetOutput();
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
    resetOutput();
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

  async function handleAnalyze() {
    const trimmedInput = inputCaseText.trim();
    if (!trimmedInput) return;
    if (topicTooLong) {
      setError(`Topics must be ${TOPIC_WORD_LIMIT} words or fewer.`);
      return;
    }
    if (analysisTooLong) {
      setError(`Pasted case text must be ${ANALYSIS_WORD_LIMIT} words or fewer.`);
      return;
    }
    setLoading(true);
    resetOutput();
    try {
      const normalizedInput = normalizeCaseStructure(trimmedInput);
      const data = await apiFetch<AnalyzeCaseResponse>("/api/cases/analyze", {
        method: "POST",
        body: JSON.stringify({
          format,
          topic: topic.trim(),
          side,
          content: normalizedInput,
        }),
      });
      setAnalysis(data);
      setCaseText(data.feedback);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to analyze case";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitAssignmentCase() {
    const trimmedCase = assignmentCaseText.trim();
    if (!assignmentRecipientId || !trimmedCase) return;
    if (topicTooLong) {
      setError(`Topics must be ${TOPIC_WORD_LIMIT} words or fewer.`);
      return;
    }
    if (assignmentTooLong) {
      setError(`Case text must be ${ANALYSIS_WORD_LIMIT} words or fewer.`);
      return;
    }
    setLoading(true);
    resetOutput();
    try {
      const normalizedCase = normalizeCaseStructure(trimmedCase);
      await apiFetch(`/api/assignments/${assignmentRecipientId}/start`, {
        method: "POST",
      });
      const data = await apiFetch<AnalyzeCaseResponse>("/api/cases/analyze", {
        method: "POST",
        body: JSON.stringify({
          format,
          topic: topic.trim(),
          side,
          content: normalizedCase,
        }),
      });
      setAnalysis(data);
      const review = await apiFetch<{ id: string }>("/api/case-reviews", {
        method: "POST",
        body: JSON.stringify({
          format,
          topic: topic.trim(),
          side,
          source_text: trimmedCase,
          score: data.score,
          category: data.category,
          summary: data.summary,
          feedback: data.feedback,
        }),
      });
      const detail = await apiFetch<AssignmentRecipientDetail>(
        `/api/assignments/${assignmentRecipientId}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ case_review_id: review.id }),
        },
      );
      setAssignmentDetail(detail);
      setAssignmentCompleted(detail.recipient.status === "completed");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to submit case";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCase() {
    if (mode === "analyze") return;
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
        Case Studio
      </h1>
      <div className="space-y-6">
        {assignmentDetail && (
          <section className="rounded-lg border border-teal/30 bg-teal/5 p-4 text-sm shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-teal-dark">
                    {assignmentDetail.assignment.title}
                  </div>
                  <div className="text-slate-600">
                  {assignmentDetail.class_room.name} / case analysis /{" "}
                  {isCasePayload(assignmentDetail.assignment)
                      ? assignmentDetail.assignment.payload.format
                      : ""}
                  </div>
                  {assignmentDetail.assignment.instructions && (
                    <p className="mt-2 whitespace-pre-wrap rounded-xl bg-white/80 px-3 py-2 text-slate-700">
                      {assignmentDetail.assignment.instructions}
                    </p>
                  )}
                </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-teal-dark">
                {assignmentCompleted
                  ? "Completed"
                  : statusLabel(assignmentDetail.recipient.status)}
              </span>
            </div>
          </section>
        )}
        {!assignmentDetail && classCaseAssignments.length > 0 && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm shadow-sm">
            <div className="font-semibold text-amber-900">
              {matchingClassCaseAssignments.length > 0
                ? `This setup matches ${matchingClassCaseAssignments.length} class case assignment${matchingClassCaseAssignments.length === 1 ? "" : "s"}.`
                : `You have ${classCaseAssignments.length} open class case assignment${classCaseAssignments.length === 1 ? "" : "s"}.`}
            </div>
            <div className="mt-1 text-amber-800">
              {matchingClassCaseAssignments.length > 0
                ? matchingClassCaseAssignments
                    .map((item) => item.assignment.title)
                    .join(" • ")
                : "Keep exploring freely here, or switch your topic/side to match the assigned case when you want to complete it."}
            </div>
          </section>
        )}
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {!assignmentLocked ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handleModeChange("create")}
                aria-pressed={mode === "create"}
                className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                  mode === "create"
                    ? "bg-teal text-white"
                    : "border border-slate-300 text-slate-700 hover:border-teal-600 hover:text-teal-700"
                }`}
              >
                Create a Case
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("analyze")}
                aria-pressed={mode === "analyze"}
                className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                  mode === "analyze"
                    ? "bg-teal text-white"
                    : "border border-slate-300 text-slate-700 hover:border-teal-600 hover:text-teal-700"
                }`}
              >
                Analyze a Case
              </button>
            </div>
          ) : null}
          <p className="mt-3 text-sm text-slate-600">
            {assignmentLocked
              ? "Write your own case for the assigned topic, then submit it for preliminary AI feedback."
              : mode === "create"
                ? "Build a fresh case from a topic and side."
                : "Paste an existing case and get strategic feedback. PDF import can come later."}
          </p>
        </section>

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
                disabled={assignmentLocked}
                className="h-10 w-full rounded border border-slate-300 px-2"
              >
                <option value="parli">Parli</option>
                <option value="mspdp">MSPDP</option>
                <option value="public_forum" disabled>
                  Public Forum (coming soon)
                </option>
              </select>
              <div className="mt-1 h-4 text-xs" aria-hidden="true" />
            </div>

            <div>
              <label
                htmlFor="topic"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                {mode === "create" ? "Topic" : "Topic / Resolution"}
              </label>
              <input
                id="topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={assignmentLocked}
                placeholder={
                  mode === "create"
                    ? "Enter a topic..."
                    : "Optional but helpful for analysis..."
                }
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
                disabled={assignmentLocked}
                className="h-10 w-full rounded border border-slate-300 px-2"
              >
                <option value="aff">Affirmative</option>
                <option value="neg">Negation</option>
              </select>
              <div className="mt-1 h-4 text-xs" aria-hidden="true" />
            </div>

            {!assignmentLocked ? (
              <>
                <button
                  type="button"
                  onClick={mode === "create" ? handleGenerate : handleAnalyze}
                  disabled={
                    loading ||
                    assignmentLoading ||
                    assignmentCompleted ||
                    topicTooLong ||
                    (mode === "create" ? !topic.trim() : !inputCaseText.trim() || analysisTooLong)
                  }
                  className="h-10 rounded bg-teal-600 px-5 font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 lg:mt-6"
                >
                  {mode === "create" ? "Generate" : "Analyze"}
                </button>
                <button
                  type="button"
                  onClick={handleRandom}
                  disabled={loading || mode !== "create"}
                  className="h-10 rounded border border-teal-600 px-5 font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 lg:mt-6"
                >
                  Random topic
                </button>
              </>
            ) : (
              <div className="lg:col-span-2 lg:mt-6">
                <p className="text-sm text-slate-600">
                  Assigned side: <span className="font-medium text-slate-900">{side === "aff" ? "Affirmative" : "Negative"}</span>
                </p>
              </div>
            )}
          </div>
          {!assignmentLocked && mode === "analyze" ? (
            <div className="mt-4">
              <label
                htmlFor="case-text"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Paste case text
              </label>
              <textarea
                id="case-text"
                value={inputCaseText}
                onChange={(e) => setInputCaseText(e.target.value)}
                disabled={assignmentLocked}
                placeholder="Paste the case you want Debby to analyze..."
                rows={12}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
              <div className="mt-1 flex justify-between text-xs">
                {analysisTooLong ? (
                  <span className="text-red-600">
                    Pasted case text must be {ANALYSIS_WORD_LIMIT} words or fewer.
                  </span>
                ) : (
                  <span className="text-slate-500">
                    Indents and subpoints are normalized before AI analysis.
                  </span>
                )}
                <span className={analysisTooLong ? "text-red-600" : "text-slate-400"}>
                  {analysisWordCount}/{ANALYSIS_WORD_LIMIT}
                </span>
              </div>
            </div>
          ) : null}
          {assignmentLocked ? (
            <div className="mt-4">
              <label
                htmlFor="assignment-case-text"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Your case
              </label>
              <textarea
                id="assignment-case-text"
                value={assignmentCaseText}
                onChange={(e) => setAssignmentCaseText(e.target.value)}
                disabled={assignmentCompleted}
                placeholder="Write your case here..."
                rows={16}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
              <div className="mt-1 flex justify-between text-xs">
                {assignmentTooLong ? (
                  <span className="text-red-600">
                    Case text must be {ANALYSIS_WORD_LIMIT} words or fewer.
                  </span>
                ) : (
                  <span className="text-slate-500">
                    Indents and subpoints are normalized before AI feedback.
                  </span>
                )}
                <span className={assignmentTooLong ? "text-red-600" : "text-slate-400"}>
                  {assignmentWordCount}/{ANALYSIS_WORD_LIMIT}
                </span>
              </div>
              {!assignmentCompleted ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={handleSubmitAssignmentCase}
                    disabled={loading || assignmentLoading || !assignmentCaseText.trim() || assignmentTooLong}
                    className="rounded bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Submit Case
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
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
              <span>{mode === "create" ? "Generating case..." : "Analyzing case..."}</span>
            </div>
          )}
          {error && !loading && (
            <div role="alert" className="text-red-600">
              {error}
            </div>
          )}
          {!loading && !error && !assignmentLocked && caseText && (
            <div>
              <div className="case-builder-actions mb-5 flex flex-wrap justify-end gap-2">
                {mode === "create" ? (
                  <button
                    type="button"
                    onClick={handleSaveCase}
                    disabled={saving || Boolean(savedCaseId)}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-teal-600 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savedCaseId ? "Saved to Library" : saving ? "Saving..." : "Save to Library"}
                  </button>
                ) : null}
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
              {mode === "analyze" && analysis ? (
                <div className="mb-6 rounded-lg border border-teal/20 bg-teal/5 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-teal-dark">
                      {analysis.category}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">
                      {analysis.score}/10
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-700">
                    {analysis.summary}
                  </p>
                </div>
              ) : null}
              <article className="case-print-document">
                <ReactMarkdown components={markdownComponents}>
                  {caseText}
                </ReactMarkdown>
              </article>
            </div>
          )}
          {!loading && !error && assignmentLocked && analysis && (
            <div>
              <div className="case-builder-actions mb-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Save PDF
                </button>
              </div>
              <div className="mb-6 rounded-lg border border-teal/20 bg-teal/5 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-teal-dark">
                    {analysis.category}
                  </span>
                  <span className="text-sm font-semibold text-slate-700">
                    {analysis.score}/10
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-700">
                  {analysis.summary}
                </p>
              </div>
              <article className="case-print-document">
                <ReactMarkdown components={markdownComponents}>
                  {analysis.feedback}
                </ReactMarkdown>
              </article>
              <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">
                  Submitted Case
                </h2>
                <div className="whitespace-pre-wrap text-sm text-slate-700">
                  {assignmentCaseText}
                </div>
              </div>
            </div>
          )}
          {!loading && !error && !caseText && !analysis && (
            <p className="text-slate-500">
              {assignmentLocked ? "Write your case above, then submit it for feedback." : mode === "create" ? "Debate Case" : "Case Analysis"}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
