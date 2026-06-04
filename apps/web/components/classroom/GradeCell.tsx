"use client";

import { useState, useEffect } from "react";
import { useFeedback } from "@/lib/queries/classroom";

interface GradeCellProps {
  recipientId: string | null;
  isEditing: boolean;
  isSaving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (recipientId: string, grade: number | null, feedback: string | null) => Promise<void>;
}

export function GradeCell({
  recipientId,
  isEditing,
  isSaving,
  onEdit,
  onCancel,
  onSave,
}: GradeCellProps) {
  const feedbackQuery = useFeedback(recipientId, false); // Start disabled
  const feedback = feedbackQuery.data;

  const [inputGrade, setInputGrade] = useState<string>("");
  const [inputFeedback, setInputFeedback] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Enable feedback query when editing
  useEffect(() => {
    if (isEditing && recipientId) {
      feedbackQuery.refetch();
    }
  }, [isEditing, recipientId]);

  // Update form state when feedback is loaded
  useEffect(() => {
    if (feedback) {
      setInputGrade(feedback.grade != null ? String(feedback.grade) : "");
      setInputFeedback(feedback.feedback ?? "");
    }
  }, [feedback]);

  if (!recipientId) {
    return <span className="text-slate-400">-</span>;
  }

  async function handleSave() {
    if (!recipientId) return;
    setError(null);
    try {
      const parsedGrade = inputGrade.trim() !== "" ? Number(inputGrade) : null;
      if (parsedGrade !== null && isNaN(parsedGrade)) {
        setError("Invalid grade");
        return;
      }
      await onSave(recipientId, parsedGrade, inputFeedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-slate-50 p-2">
        <input
          type="number"
          value={inputGrade}
          onChange={(e) => setInputGrade(e.target.value)}
          placeholder="Grade"
          step="0.1"
          className="h-7 w-16 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-1 focus:ring-teal/20"
          autoFocus
        />
        <textarea
          value={inputFeedback}
          onChange={(e) => setInputFeedback(e.target.value)}
          placeholder="Feedback..."
          rows={2}
          className="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-1 focus:ring-teal/20"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 rounded bg-teal px-2 py-1 text-xs font-medium text-white transition hover:bg-teal-dark disabled:opacity-60"
          >
            {isSaving ? "..." : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const displayGrade = feedback?.grade ?? null;
  return (
    <button
      type="button"
      onClick={onEdit}
      className="inline-flex h-8 w-16 items-center justify-center rounded border border-slate-200 bg-white text-sm font-medium text-slate-900 transition hover:border-teal hover:bg-teal/5"
    >
      {displayGrade != null ? displayGrade : "-"}
    </button>
  );
}
