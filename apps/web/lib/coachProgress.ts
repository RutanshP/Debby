// Types and helpers for the instructor progress dashboard.

import type { ProgressRound, ProgressDrill } from "@/lib/progress";
import { shortId } from "@/lib/classroom";

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

export { shortId };

/** Look up display names for a list of user IDs via the profiles endpoint.
 *  Degrades gracefully to shortId on any error or missing entry. */
export async function resolveDisplayNames(
  userIds: string[],
  apiFetch: (url: string, opts?: RequestInit) => Promise<unknown>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>(userIds.map((id) => [id, shortId(id)]));
  if (userIds.length === 0) return map;
  try {
    // /api/profiles/lookup returns a { user_id: display_name } map.
    const profiles = (await apiFetch("/api/profiles/lookup", {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    })) as Record<string, string>;
    for (const [userId, displayName] of Object.entries(profiles)) {
      if (displayName) map.set(userId, displayName);
    }
  } catch {
    // Degrade to shortId — already set above.
  }
  return map;
}
