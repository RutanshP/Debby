export type ClassRole = "coach" | "competitor";
export type AssignmentType = "drill" | "practice_round" | "case";
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

export interface CaseAssignmentPayload {
  format: PracticeFormat;
  topic: string;
  side: PracticeSide;
}

export type AssignmentPayload =
  | DrillAssignmentPayload
  | PracticeRoundAssignmentPayload
  | CaseAssignmentPayload;

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
  case_review_id?: string | null;
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

export function isCasePayload(
  assignment: Assignment,
): assignment is Assignment & { payload: CaseAssignmentPayload } {
  return assignment.type === "case";
}

export function isCoachAssignmentSummary(
  value: CoachAssignmentSummary | AssignmentRecipientDetail,
): value is CoachAssignmentSummary {
  return "recipients" in value;
}

export function assignmentTypeLabel(type: AssignmentType): string {
  if (type === "practice_round") return "Practice round";
  if (type === "case") return "Case analysis";
  return "Drill";
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

export function assignmentHref(detail: AssignmentRecipientDetail): string {
  const id = detail.recipient.id;
  const classId = detail.class_room.id;
  if (detail.assignment.type === "drill") {
    return `/drills?class=${classId}&assignment=${id}`;
  }
  if (detail.assignment.type === "case") {
    return `/parli-gpt?class=${classId}&assignment=${id}`;
  }
  return `/practice?class=${classId}&assignment=${id}`;
}

export function withClassContext(href: string, classId?: string | null): string {
  if (!classId) return href;
  const [path, hash = ""] = href.split("#", 2);
  const separator = path.includes("?") ? "&" : "?";
  const next = path.includes("class=")
    ? path
    : `${path}${separator}class=${encodeURIComponent(classId)}`;
  return hash ? `${next}#${hash}` : next;
}

export function resultSummary(result?: Record<string, unknown> | null): string {
  if (!result) return "No result yet";
  if (typeof result.numeric_score === "number") return `Score ${result.numeric_score}/10`;
  if (typeof result.score === "number") return `Score ${result.score}/10`;
  if (typeof result.category === "string") return String(result.category);
  const score = result.score;
  if (score && typeof score === "object" && "score" in score) {
    const numeric = (score as { score?: unknown }).score;
    if (typeof numeric === "number" || typeof numeric === "string") {
      return `Score ${numeric}/10`;
    }
  }
  if (typeof result.wpm === "number") return `${Math.round(result.wpm)} WPM`;
  if (result.winner_side === "aff" || result.winner_side === "neg") {
    return `Winner: ${result.winner_side}`;
  }
  if (typeof result.rfd === "string" && result.rfd.trim()) {
    return result.rfd.trim().slice(0, 80);
  }
  return "Result saved";
}
