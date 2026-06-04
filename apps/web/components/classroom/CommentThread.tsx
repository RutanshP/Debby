"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  type Comment,
  createComment,
  deleteComment,
  formatCommentDate,
  listComments,
  resolveUserNames,
  shortId,
} from "@/lib/comments";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";

interface CommentThreadProps {
  classId: string;
  targetType: string;
  targetId: string;
  /** When true, users can mark a comment as private. */
  allowPrivate?: boolean;
  /** The current authenticated user's ID, used to show "delete" on own comments. */
  currentUserId?: string;
  /** Role of the current user in the class; coaches can delete any comment. */
  currentUserRole?: "coach" | "competitor";
}

export function CommentThread({
  classId,
  targetType,
  targetId,
  allowPrivate = false,
  currentUserId,
  currentUserRole,
}: CommentThreadProps) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listComments(targetType, targetId);
      setComments(rows);
      // Resolve author names.
      const uniqueIds = [...new Set(rows.map((c) => c.author_id))];
      const resolved = await resolveUserNames(uniqueIds);
      setNames(resolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    if (expanded) {
      void load();
    }
  }, [expanded, load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const comment = await createComment({
        class_id: classId,
        target_type: targetType,
        target_id: targetId,
        body: body.trim(),
        is_private: isPrivate,
      });
      setComments((prev) => [...prev, comment]);
      setBody("");
      setIsPrivate(false);
      // Resolve the new author name if not yet known.
      if (comment.author_id && !names[comment.author_id]) {
        const resolved = await resolveUserNames([comment.author_id]);
        if (Object.keys(resolved).length > 0) {
          setNames((prev) => ({ ...prev, ...resolved }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete comment");
    }
  }

  function canDelete(comment: Comment): boolean {
    if (!currentUserId) return false;
    if (comment.author_id === currentUserId) return true;
    if (currentUserRole === "coach") return true;
    return false;
  }

  function authorName(authorId: string): string {
    return names[authorId] ?? shortId(authorId);
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-sm font-medium text-teal hover:text-teal-dark"
        aria-expanded={expanded}
      >
        {expanded
          ? "Hide comments"
          : comments.length > 0
            ? `${comments.length} comment${comments.length === 1 ? "" : "s"}`
            : "Add comment"}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {error && (
            <p className="text-xs text-red-600" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <p className="text-xs text-slate-500">Loading comments…</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="comments">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className={`rounded-md p-2 text-sm ${
                    comment.is_private
                      ? "border border-amber-200 bg-amber-50"
                      : "bg-slate-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <span className="font-medium text-slate-800">
                        {authorName(comment.author_id)}
                      </span>
                      {comment.is_private && (
                        <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-xs font-semibold text-amber-700">
                          private
                        </span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">
                        {formatCommentDate(comment.created_at)}
                      </span>
                      <p className="mt-1 text-slate-700">{comment.body}</p>
                    </div>
                    {canDelete(comment) && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(comment.id)}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                        aria-label="Delete comment"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {comments.length === 0 && !loading && (
                <li className="text-xs text-slate-500">No comments yet.</li>
              )}
            </ul>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={fieldClass}
              placeholder="Add a class comment…"
              disabled={submitting}
              aria-label="Comment body"
            />
            {allowPrivate && (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-teal"
                />
                Private (only you and your coach can see this)
              </label>
            )}
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className={primaryButtonClass}
            >
              {submitting ? "Posting…" : "Post"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default CommentThread;
