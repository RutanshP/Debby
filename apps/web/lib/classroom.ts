export type ClassRole = "coach" | "competitor";
export type AssignmentType = "drill" | "practice_round";
export type AssignmentStatus = "assigned" | "in_progress" | "completed";
export type DrillAssignmentType =
  | "rebuttal"
  | "speed"
  | "impact"
  | "contention"
  | "filler";
export type PracticeFormat = "parli" | "mspdp";
export type PracticeSide = "aff" | "neg";

export interface ClassRoom {
  id: string;
  name: string;
  join_code: string;
  created_by: string;
  created_at?: string | null;
  archived?: boolean;
}

export interface ClassMember {
  class_id: string;
  user_id: string;
  role: ClassRole;
  joined_at?: string | null;
}

export interface DrillAssignmentPayload {
  drill_type: DrillAssignmentType;
  timer_seconds: number;
}

export interface PracticeRoundAssignmentPayload {
  format: PracticeFormat;
  topic: string;
  side: PracticeSide;
  speech_duration_seconds: number;
}

export type AssignmentPayload =
  | DrillAssignmentPayload
  | PracticeRoundAssignmentPayload;

export interface Assignment {
  id: string;
  class_id: string;
  assigned_by: string;
  title: string;
  type: AssignmentType;
  payload: AssignmentPayload;
  due_at?: string | null;
  created_at?: string | null;
}

export interface AssignmentRecipient {
  id: string;
  assignment_id: string;
  user_id: string;
  status: AssignmentStatus;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface AssignmentSubmission {
  id: string;
  recipient_id: string;
  user_id: string;
  drill_id?: string | null;
  round_id?: string | null;
  created_at?: string | null;
}

export interface ClassListItem {
  id: string;
  name: string;
  join_code: string;
  role: ClassRole;
  open_assignments: number;
  created_at?: string | null;
}

export interface AssignmentRecipientDetail {
  recipient: AssignmentRecipient;
  assignment: Assignment;
  class_room: ClassRoom;
  submission?: AssignmentSubmission | null;
  result?: Record<string, unknown> | null;
}

export interface CoachAssignmentSummary {
  assignment: Assignment;
  recipients: AssignmentRecipient[];
  submissions: AssignmentSubmission[];
  results: Record<string, Record<string, unknown>>;
}

export interface ClassDetail {
  class_room: ClassRoom;
  role: ClassRole;
  roster: ClassMember[];
  assignments: Array<CoachAssignmentSummary | AssignmentRecipientDetail>;
}

export interface StartAssignmentResponse {
  recipient: AssignmentRecipient;
  assignment: Assignment;
  round_id?: string | null;
}

export function isDrillPayload(
  assignment: Assignment,
): assignment is Assignment & { payload: DrillAssignmentPayload } {
  return assignment.type === "drill";
}

export function isPracticePayload(
  assignment: Assignment,
): assignment is Assignment & { payload: PracticeRoundAssignmentPayload } {
  return assignment.type === "practice_round";
}

export function isCoachAssignmentSummary(
  value: CoachAssignmentSummary | AssignmentRecipientDetail,
): value is CoachAssignmentSummary {
  return "recipients" in value;
}

export function assignmentTypeLabel(type: AssignmentType): string {
  return type === "practice_round" ? "Practice round" : "Drill";
}

export function statusLabel(status: AssignmentStatus): string {
  if (status === "in_progress") return "In progress";
  return status[0].toUpperCase() + status.slice(1);
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function formatDate(value?: string | null): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
