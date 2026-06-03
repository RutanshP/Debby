"use client";

import { useEffect, useState } from "react";
import {
  getFeedback,
  upsertFeedback,
  type SubmissionFeedback,
} from "@/lib/feedback";

const fieldClass =
  "rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";

const primaryButtonClass =
  "inline-flex h-9 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";

interface FeedbackPanelProps {
  recipientId: string;
  /** When true, the panel renders a coach editor. When false, read-only student view. */
  isCoach: boolean;
  /** Optional initial feedback (avoids an extra fetch when parent already has the data). */
  initialFeedback?: SubmissionFeedback | null;
}

export function FeedbackPanel({
  recipientId,
  isCoach,
  initialFeedback,
}: FeedbackPanelProps) {
  const [feedback, setFeedback] = useState<SubmissionFeedback | null>(
    initialFeedback ?? null,
  );
  const [grade, setGrade] = useState<string>(
    initialFeedback?.grade != null ? String(initialFeedback.grade) : "",
  );
  const [text, setText] = useState<string>(initialFeedback?.feedback ?? "");
  const [returned, setReturned] = useState<boolean>(
    initialFeedback?.returned ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // If we already have initial data skip the fetch.
    if (initialFeedback !== undefined) return;
    let cancelled = false;
    getFeedback(recipientId).then((fb) => {
      if (cancelled) return;
      if (fb) {
        setFeedback(fb);
        setGrade(fb.grade != null ? String(fb.grade) : "");
        setText(fb.feedback ?? "");
        setReturned(fb.returned);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [recipientId, initialFeedback]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const parsedGrade = grade.trim() !== "" ? Number(grade) : null;
      const updated = await upsertFeedback(recipientId, {
        grade: parsedGrade,
        feedback: text.trim() !== "" ? text : null,
        returned,
      });
      setFeedback(updated);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setSaving(false);
    }
  }

  if (!isCoach) {
    // Student read-only view — only shown if returned.
    if (!feedback?.returned) return null;
    return (
      <div
        className="mt-3 rounded-md border border-teal/30 bg-teal/5 p-3"
        aria-label="Coach feedback"
      >
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-dark">
          Coach Feedback
        </p>
        {feedback.grade != null && (
          <p className="text-sm text-slate-700">
            <span className="font-medium">Grade:</span> {feedback.grade}
          </p>
        )}
        {feedback.feedback && (
          <p className="mt-1 text-sm text-slate-700">{feedback.feedback}</p>
        )}
      </div>
    );
  }

  // Coach editor view.
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Coach Feedback
      </p>

      {error && (
        <p className="mb-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="mb-2 text-xs text-teal-dark" role="status">
          Saved
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Grade
          <input
            type="number"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="e.g. 8.5"
            className={`${fieldClass} h-8 w-32`}
            aria-label="Grade"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Feedback
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your feedback..."
            rows={3}
            className={`${fieldClass} py-2`}
            aria-label="Feedback text"
          />
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={returned}
            onChange={(e) => setReturned(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-teal"
            aria-label="Return to student"
          />
          Return to student
        </label>

        <div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={primaryButtonClass}
          >
            {saving ? "Saving..." : "Save feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
