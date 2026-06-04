"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import {
  authorShortId,
  createPost,
  deletePost,
  fetchPosts,
  formatPostDate,
  youtubeVideoId,
  type ClassPost,
  type PostType,
} from "@/lib/stream";
import {
  assignmentHref,
  formatDate,
  resultSummary,
  statusLabel,
  type AssignmentRecipientDetail,
  type ClassDetail,
} from "@/lib/classroom";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";

interface AuthorNames {
  [userId: string]: string;
}

type StreamCache = {
  posts: ClassPost[];
  authorNames: AuthorNames;
  savedAt: number;
};

type FeedItem =
  | { kind: "post"; createdAt: string | null; post: ClassPost }
  | {
      kind: "assignment";
      createdAt: string | null;
      assignment: AssignmentRecipientDetail;
    };

const STREAM_CACHE_PREFIX = "debby-stream-cache-v1:";
const STREAM_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const streamMemoryCache = new Map<string, StreamCache>();

async function lookupAuthorNames(userIds: string[]): Promise<AuthorNames> {
  if (userIds.length === 0) return {};
  try {
    const data = await apiFetch<Record<string, { name?: string; email?: string }>>(
      "/api/profiles/lookup",
      {
        method: "POST",
        body: JSON.stringify({ user_ids: userIds }),
      },
    );
    const names: AuthorNames = {};
    for (const [id, profile] of Object.entries(data)) {
      names[id] = profile.name ?? profile.email ?? authorShortId(id);
    }
    return names;
  } catch {
    return {};
  }
}

function AuthorLabel({ userId, names }: { userId: string; names: AuthorNames }) {
  return <span>{names[userId] ?? authorShortId(userId)}</span>;
}

function getStreamCacheKey(classId: string): string {
  return `${STREAM_CACHE_PREFIX}${classId}`;
}

function readStreamCache(classId: string): StreamCache | null {
  const now = Date.now();
  const memory = streamMemoryCache.get(classId);
  if (memory && now - memory.savedAt <= STREAM_CACHE_MAX_AGE_MS) {
    return memory;
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getStreamCacheKey(classId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StreamCache;
    if (now - parsed.savedAt > STREAM_CACHE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(getStreamCacheKey(classId));
      return null;
    }
    streamMemoryCache.set(classId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeStreamCache(classId: string, cache: StreamCache) {
  streamMemoryCache.set(classId, cache);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getStreamCacheKey(classId), JSON.stringify(cache));
  } catch {
    // Ignore storage failures.
  }
}

/** Returns true only for http: or https: URLs to prevent javascript: XSS. */
function isSafeUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function LinkPreview({ url }: { url: string }) {
  if (!isSafeUrl(url)) return null;

  const videoId = youtubeVideoId(url);
  if (videoId) {
    return (
      <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg border border-slate-200">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1 text-sm text-teal underline hover:text-teal-dark"
    >
      {url}
    </a>
  );
}

function PostCard({
  post,
  names,
  isCoach,
  classId,
  onDeleted,
}: {
  post: ClassPost;
  names: AuthorNames;
  isCoach: boolean;
  classId: string;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this post?")) return;
    setDeleting(true);
    try {
      await deletePost(classId, post.id);
      onDeleted(post.id);
    } catch {
      // Silently ignore; parent can re-fetch if needed.
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
              post.type === "announcement"
                ? "bg-teal/10 text-teal-dark"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {post.type === "announcement" ? "Announcement" : "Material"}
          </span>
          <span className="text-xs text-slate-400">
            <AuthorLabel userId={post.author_id} names={names} />
            {" · "}
            {formatPostDate(post.created_at)}
          </span>
        </div>
        {isCoach && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Delete post"
            className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      {post.title && (
        <h3 className="mt-2 font-semibold text-slate-900">{post.title}</h3>
      )}
      {post.body && (
        <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
          {post.body}
        </p>
      )}
      {post.link_url && <LinkPreview url={post.link_url} />}
    </article>
  );
}

interface StreamTabProps {
  classDetail: ClassDetail;
  assignments?: AssignmentRecipientDetail[];
}

export function StreamTab({ classDetail, assignments = [] }: StreamTabProps) {
  const classId = classDetail.class_room.id;
  const isCoach = classDetail.role === "coach";

  const [posts, setPosts] = useState<ClassPost[]>([]);
  const [authorNames, setAuthorNames] = useState<AuthorNames>({});
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postError, setPostError] = useState<string | null>(null);

  // Composer state (coach only).
  const [postType, setPostType] = useState<PostType>("announcement");
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postLink, setPostLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const feedItems: FeedItem[] = [
    ...posts.map((post) => ({
      kind: "post" as const,
      createdAt: post.created_at ?? null,
      post,
    })),
    ...(!isCoach
      ? assignments.map((assignment) => ({
          kind: "assignment" as const,
          createdAt:
            assignment.assignment.created_at ??
            assignment.recipient.created_at ??
            assignment.assignment.due_at ??
            null,
          assignment,
        }))
      : []),
  ].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });

  const refreshNames = useCallback(async (postList: ClassPost[]) => {
    const ids = [...new Set(postList.map((p) => p.author_id))];
    const names = await lookupAuthorNames(ids);
    setAuthorNames(names);
    writeStreamCache(classId, {
      posts: postList,
      authorNames: names,
      savedAt: Date.now(),
    });
  }, [classId]);

  const loadPosts = useCallback(async () => {
    const cached = readStreamCache(classId);
    if (cached) {
      setPosts(cached.posts);
      setAuthorNames(cached.authorNames);
      setLoadingPosts(false);
    } else {
      setLoadingPosts(true);
    }
    setPostError(null);
    try {
      const fetched = await fetchPosts(classId);
      setPosts(fetched);
      const ids = [...new Set(fetched.map((p) => p.author_id))];
      const names = await lookupAuthorNames(ids);
      setAuthorNames(names);
      writeStreamCache(classId, {
        posts: fetched,
        authorNames: names,
        savedAt: Date.now(),
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setPostError(err.message);
      } else {
        setPostError("Failed to load posts.");
      }
    } finally {
      setLoadingPosts(false);
    }
  }, [classId, refreshNames]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!postBody.trim() && !postTitle.trim()) return;
    setSaving(true);
    setComposerError(null);
    try {
      const newPost = await createPost(classId, {
        type: postType,
        title: postTitle.trim() || null,
        body: postBody.trim() || null,
        link_url: postLink.trim() || null,
      });
      setPosts((prev) => [newPost, ...prev]);
      const nextPosts = [newPost, ...posts];
      await refreshNames(nextPosts);
      setPostTitle("");
      setPostBody("");
      setPostLink("");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Failed to post.";
      setComposerError(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleDeleted(postId: string) {
    setPosts((prev) => {
      const nextPosts = prev.filter((p) => p.id !== postId);
      writeStreamCache(classId, {
        posts: nextPosts,
        authorNames,
        savedAt: Date.now(),
      });
      return nextPosts;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Class banner */}
      <div className="flex items-end rounded-xl bg-gradient-to-br from-teal to-teal-dark p-6 text-white shadow-md">
        <div>
          <h2 className="text-2xl font-bold">{classDetail.class_room.name}</h2>
          <p className="mt-1 text-sm capitalize opacity-80">
            {classDetail.role} &middot; Code:{" "}
            <span className="font-mono font-semibold">
              {classDetail.class_room.join_code}
            </span>
          </p>
        </div>
      </div>

      {/* Coach composer */}
      {isCoach && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Type
              <select
                value={postType}
                onChange={(e) => setPostType(e.target.value as PostType)}
                className={fieldClass}
              >
                <option value="announcement">Announcement</option>
                <option value="material">Material</option>
              </select>
            </label>
            <label className={labelClass}>
              Title (optional)
              <input
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value)}
                className={fieldClass}
                placeholder="e.g. Watch this breakdown"
              />
            </label>
          </div>
          <label className={labelClass}>
            Message
            <textarea
              value={postBody}
              onChange={(e) => setPostBody(e.target.value)}
              rows={3}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100"
              placeholder="Write an announcement or describe the material..."
            />
          </label>
          <label className={labelClass}>
            Link URL (optional)
            <input
              value={postLink}
              onChange={(e) => setPostLink(e.target.value)}
              className={fieldClass}
              placeholder="https://youtube.com/watch?v=..."
              type="url"
            />
          </label>
          {composerError && (
            <p className="text-sm text-red-600">{composerError}</p>
          )}
          <div>
            <button
              type="submit"
              disabled={saving || (!postBody.trim() && !postTitle.trim())}
              className={primaryButtonClass}
            >
              {saving ? "Posting..." : "Post"}
            </button>
          </div>
        </form>
      )}

      {/* Posts list */}
      {postError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {postError}
        </div>
      )}

      {loadingPosts ? (
        <p className="text-sm text-slate-500">Loading posts...</p>
      ) : feedItems.length === 0 ? (
        <p className="text-sm text-slate-500">
          {isCoach
            ? "No posts yet. Use the form above to post an announcement or material."
            : "Nothing has been posted yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="posts-list">
          {feedItems.map((item) =>
            item.kind === "post" ? (
              <PostCard
                key={item.post.id}
                post={item.post}
                names={authorNames}
                isCoach={isCoach}
                classId={classId}
                onDeleted={handleDeleted}
              />
            ) : (
              <article
                key={item.assignment.recipient.id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Assignment
                    </span>
                    <span className="text-xs text-slate-400">
                      Posted {formatDate(item.assignment.assignment.created_at)}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-teal-dark">
                    {statusLabel(item.assignment.recipient.status)}
                  </span>
                </div>
                <h3 className="mt-2 font-semibold text-slate-900">
                  {item.assignment.assignment.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Due {formatDate(item.assignment.assignment.due_at)}
                </p>
                {item.assignment.result && (
                  <p className="mt-1 text-sm text-slate-600">
                    {resultSummary(item.assignment.result)}
                  </p>
                )}
                <Link
                  href={assignmentHref(item.assignment)}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal transition hover:text-teal-dark"
                >
                  Open assignment
                </Link>
              </article>
            ),
          )}
        </div>
      )}
    </div>
  );
}
