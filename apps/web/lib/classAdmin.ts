import { apiFetch } from "@/lib/api";
import type { Assignment, ClassRoom } from "@/lib/classroom";

// ---- Request types ----

export interface UpdateClassPayload {
  name?: string;
  archived?: boolean;
}

export interface UpdateAssignmentPayload {
  title?: string;
  due_at?: string | null;
}

// ---- API helpers ----

export async function renameClass(
  classId: string,
  name: string,
): Promise<ClassRoom> {
  return apiFetch<ClassRoom>(`/api/classes/${classId}`, {
    method: "PATCH",
    body: JSON.stringify({ name } satisfies UpdateClassPayload),
  });
}

export async function archiveClass(
  classId: string,
  archived: boolean,
): Promise<ClassRoom> {
  return apiFetch<ClassRoom>(`/api/classes/${classId}`, {
    method: "PATCH",
    body: JSON.stringify({ archived } satisfies UpdateClassPayload),
  });
}

export async function regenerateJoinCode(classId: string): Promise<ClassRoom> {
  return apiFetch<ClassRoom>(`/api/classes/${classId}/regenerate-code`, {
    method: "POST",
  });
}

export async function removeMember(
  classId: string,
  userId: string,
): Promise<void> {
  await apiFetch<void>(`/api/classes/${classId}/members/${userId}`, {
    method: "DELETE",
  });
}

export async function leaveClass(classId: string): Promise<void> {
  await apiFetch<void>(`/api/classes/${classId}/leave`, {
    method: "POST",
  });
}

export async function updateAssignment(
  assignmentId: string,
  payload: UpdateAssignmentPayload,
): Promise<Assignment> {
  return apiFetch<Assignment>(`/api/assignments/${assignmentId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  await apiFetch<void>(`/api/assignments/${assignmentId}`, {
    method: "DELETE",
  });
}
