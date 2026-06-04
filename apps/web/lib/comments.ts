import { apiFetch } from "@/lib/api";

export interface Comment {
  id: string;
  class_id: string;
  target_type: string;
  target_id: string;
  author_id: string;
  body: string;
  is_private: boolean;
  created_at?: string | null;
}

export interface CreateCommentRequest {
  class_id: string;
  target_type: string;
  target_id: string;
  body: string;
  is_private?: boolean;
}

export async function listComments(
  targetType: string,
  targetId: string,
): Promise<Comment[]> {
  return apiFetch<Comment[]>(
    `/api/comments?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`,
  );
}

export async function createComment(req: CreateCommentRequest): Promise<Comment> {
  return apiFetch<Comment>("/api/comments", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function deleteComment(commentId: string): Promise<void> {
  await apiFetch<void>(`/api/comments/${commentId}`, { method: "DELETE" });
}

/** Shorten a UUID to its first 8 characters for display when no name is available. */
export function shortId(id: string): string {
  if (!id) return "";
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function formatCommentDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Resolve display names for a list of user IDs by calling the profiles/lookup
 * endpoint. Degrades gracefully to shortId on any error.
 */
export async function resolveUserNames(
  userIds: string[],
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  try {
    const result = await apiFetch<Record<string, string>>("/api/profiles/lookup", {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    });
    return result ?? {};
  } catch {
    // Degrade to shortId for all users if the endpoint is unavailable.
    return {};
  }
}
