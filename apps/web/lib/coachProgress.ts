// Types and helpers for the instructor progress dashboard.

import type { ProgressRound, ProgressDrill } from "@/lib/progress";

export interface StudentProgressData {
  user_id: string;
  rounds: ProgressRound[];
  drills: ProgressDrill[];
}

export interface ClassProgressResponse {
  students: StudentProgressData[];
}

/** Resolved display name for a student. */
export interface StudentMeta {
  userId: string;
  displayName: string;
}

/** Flatten all students' rounds and drills into one combined set for the class aggregate. */
export function flattenClassProgress(students: StudentProgressData[]): {
  rounds: ProgressRound[];
  drills: ProgressDrill[];
} {
  const rounds: ProgressRound[] = [];
  const drills: ProgressDrill[] = [];
  for (const student of students) {
    rounds.push(...student.rounds);
    drills.push(...student.drills);
  }
  return { rounds, drills };
}

/** Build a display name using first 8 chars of the user ID as a fallback. */
export function shortId(userId: string): string {
  return userId.length > 8 ? userId.slice(0, 8) : userId;
}

/** Look up display names for a list of user IDs via the profiles endpoint.
 *  Degrades gracefully to shortId on any error or missing entry. */
export async function resolveDisplayNames(
  userIds: string[],
  apiFetch: (url: string, opts?: RequestInit) => Promise<unknown>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>(userIds.map((id) => [id, shortId(id)]));
  if (userIds.length === 0) return map;
  try {
    const profiles = (await apiFetch("/api/profiles/lookup", {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    })) as Array<{ user_id: string; display_name?: string; full_name?: string; email?: string }>;
    if (Array.isArray(profiles)) {
      for (const profile of profiles) {
        const name =
          profile.display_name ?? profile.full_name ?? profile.email ?? shortId(profile.user_id);
        map.set(profile.user_id, name);
      }
    }
  } catch {
    // Degrade to shortId — already set above.
  }
  return map;
}
