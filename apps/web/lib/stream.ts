import { apiFetch } from "@/lib/api";

export type PostType = "announcement" | "material";

export interface ClassPost {
  id: string;
  class_id: string;
  author_id: string;
  type: PostType;
  title?: string | null;
  body?: string | null;
  link_url?: string | null;
  created_at?: string | null;
}

export interface CreatePostRequest {
  type: PostType;
  title?: string | null;
  body?: string | null;
  link_url?: string | null;
}

export async function fetchPosts(classId: string): Promise<ClassPost[]> {
  return apiFetch<ClassPost[]>(`/api/classes/${classId}/posts`);
}

export async function createPost(
  classId: string,
  req: CreatePostRequest,
): Promise<ClassPost> {
  return apiFetch<ClassPost>(`/api/classes/${classId}/posts`, {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function deletePost(
  classId: string,
  postId: string,
): Promise<void> {
  await apiFetch<void>(`/api/classes/${classId}/posts/${postId}`, {
    method: "DELETE",
  });
}

/** Returns a short (8-char) fallback display name from a UUID. */
export function authorShortId(userId: string): string {
  return userId.slice(0, 8);
}

/** Format a date string as a relative or absolute label. */
export function formatPostDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Detect a YouTube URL and return the video ID, or null. */
export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com"
    ) {
      return parsed.searchParams.get("v");
    }
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1) || null;
    }
  } catch {
    // Not a valid URL.
  }
  return null;
}
