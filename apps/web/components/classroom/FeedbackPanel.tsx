"use client";

import { useEffect, useState } from "react";
import {
  upsertFeedback,
  type SubmissionFeedback,
} from "@/lib/feedback";
import { classroomKeys, useFeedback, useQueryClient } from "@/lib/queries/classroom";

const fieldClass =
  "rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";

const primaryButtonClass =
  "inline-flex h-9 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";

interface FeedbackPanelProps {
  recipientId: string;
  isCoach: boolean;
  initialFeedback?: SubmissionFeedback | null;
}

export function FeedbackPanel({
  recipientId,
  isCoach,
  initialFeedback,
}: FeedbackPanelProps) {
  const queryClient = useQueryClient();
  const feedbackQuery = useFeedback(recipientId, initialFeedback === undefined);
  const [savedFeedback, setSavedFeedback] = useState<SubmissionFeedback | null>(
    initialFeedback ?? null,
  );
  const feedback = savedFeedback ?? feedbackQuery.data ?? null;

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
  const [editing, setEditing] = useState<boolean>(() => !(initialFeedback && isCoach));

  useEffect(() => {
    if (!feedback) return;
    setGrade(feedback.grade != null ? String(feedback.grade) : "");
    setText(feedback.feedback ?? "");
    setReturned(feedback.returned);
    if (isCoach && initialFeedback === undefined) {
      setEditing(false);
    }
  }, [feedback, initialFeedback, isCoach]);

  const displayError = error || (feedbackQuery.isError ? "Failed to load feedback" : null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const parsedGrade = grade.trim() !== "" ? Number(grade) : null;
      const nextFeedback = await upsertFeedback(recipientId, {
        grade: parsedGrade,
        feedback: text.trim() !== "" ? text : null,
        returned,
      });
      setSavedFeedback(nextFeedback);
      await queryClient.invalidateQueries({
        queryKey: classroomKeys.feedback(recipientId),
      });
      setSuccess(true);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setSaving(false);
    }
  }

  if (!isCoach) {
    if (!feedback?.returned) {
      return (
        <div
          className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500"
          aria-label="Coach feedback"
        >
          No feedback yet.
        </div>
      );
    }
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

  if (feedback && !editing) {
    return (
      <div className="mt-3 rounded-md border border-teal/30 bg-teal/5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-dark">
              Coach Feedback
            </p>
            {success && (
              <p className="mb-2 text-xs text-teal-dark" role="status">
                Feedback sent
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setSuccess(false);
            }}
            className="text-xs font-medium text-teal underline hover:text-teal-dark"
          >
            Edit
          </button>
        </div>
        <div className="space-y-1 text-sm text-slate-700">
          {feedback.grade != null && (
            <p>
              <span className="font-medium">Grade:</span> {feedback.grade}
            </p>
          )}
          {feedback.feedback && <p className="whitespace-pre-line">{feedback.feedback}</p>}
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {feedback.returned ? "Returned to student" : "Saved privately"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Coach Feedback
      </p>

      {displayError && (
        <p className="mb-2 text-xs text-red-600" role="alert">
          {displayError}
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
