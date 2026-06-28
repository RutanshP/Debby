import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ClassListItem, ClassDetail } from "@/lib/classroom";
import { getFeedback } from "@/lib/feedback";
import type { SubmissionFeedback } from "@/lib/feedback";
import type { QueryClient } from "@tanstack/react-query";

// Query keys
export const classroomKeys = {
  all: ["classes"] as const,
  lists: () => [...classroomKeys.all, "list"] as const,
  list: () => [...classroomKeys.lists()] as const,
  details: () => [...classroomKeys.all, "detail"] as const,
  detail: (classId: string) => [...classroomKeys.details(), classId] as const,
  progress: (classId: string) => [...classroomKeys.detail(classId), "progress"] as const,
  posts: (classId: string) => [...classroomKeys.detail(classId), "posts"] as const,
  feedbacks: () => [...classroomKeys.all, "feedback"] as const,
  feedback: (recipientId: string) => [...classroomKeys.feedbacks(), recipientId] as const,
};

interface ClassProgressResponse {
  [key: string]: unknown;
}

interface ClassPost {
  id: string;
  class_id: string;
  author_id: string;
  type: "announcement" | "material";
  title?: string | null;
  body?: string | null;
  url?: string | null;
  created_at?: string | null;
}

/**
 * Fetch all classes for the current user
 */
export function useClasses() {
  return useQuery({
    queryKey: classroomKeys.list(),
    queryFn: async () => {
      return apiFetch<ClassListItem[]>("/api/classes");
    },
  });
}

/**
 * Fetch detailed information for a specific class
 * @param classId - The class ID, or null to disable the query
 */
export function useClassDetail(classId: string | null) {
  return useQuery({
    queryKey: classroomKeys.detail(classId ?? ""),
    queryFn: async () => {
      if (!classId) throw new Error("classId is required");
      return apiFetch<ClassDetail>(`/api/classes/${classId}`);
    },
    enabled: !!classId,
  });
}

/**
 * Fetch progress data for a specific class
 * @param classId - The class ID
 * @param enabled - Whether to enable the query (e.g., based on active tab)
 */
export function useClassProgress(classId: string | null, enabled = true) {
  return useQuery({
    queryKey: classroomKeys.progress(classId ?? ""),
    queryFn: async () => {
      if (!classId) throw new Error("classId is required");
      return apiFetch<ClassProgressResponse>(`/api/classes/${classId}/progress`);
    },
    enabled: enabled && !!classId,
  });
}

/**
 * Fetch posts (stream) for a specific class
 * @param classId - The class ID
 * @param enabled - Whether to enable the query (e.g., based on active tab)
 */
export function useClassPosts(classId: string | null, enabled = true) {
  return useQuery({
    queryKey: classroomKeys.posts(classId ?? ""),
    queryFn: async () => {
      if (!classId) throw new Error("classId is required");
      return apiFetch<ClassPost[]>(`/api/classes/${classId}/posts`);
    },
    enabled: enabled && !!classId,
  });
}

/**
 * Fetch feedback for a specific assignment recipient
 * @param recipientId - The assignment recipient ID
 * @param enabled - Whether to enable the query (e.g., based on feedback panel expansion)
 */
export function useFeedback(recipientId: string | null, enabled = true) {
  return useQuery({
    queryKey: classroomKeys.feedback(recipientId ?? ""),
    queryFn: async () => {
      if (!recipientId) throw new Error("recipientId is required");
      return getFeedback(recipientId);
    },
    enabled: enabled && !!recipientId,
  });
}

export async function invalidateClassroomCaches(
  queryClient: QueryClient,
  classId?: string | null,
): Promise<void> {
  const jobs = [queryClient.invalidateQueries({ queryKey: classroomKeys.list() })];
  if (classId) {
    jobs.push(queryClient.invalidateQueries({ queryKey: classroomKeys.detail(classId) }));
    jobs.push(queryClient.invalidateQueries({ queryKey: classroomKeys.progress(classId) }));
    jobs.push(queryClient.invalidateQueries({ queryKey: classroomKeys.posts(classId) }));
  }
  await Promise.all(jobs);
}

/**
 * Get the query client for manual invalidations
 * Usage: const queryClient = useQueryClient();
 *        await queryClient.invalidateQueries({ queryKey: classroomKeys.list() });
 */
export { useQueryClient } from "@tanstack/react-query";
