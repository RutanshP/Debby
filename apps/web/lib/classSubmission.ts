export type Side = "aff" | "neg";

export interface WpmPoint {
  t: number;
  wpm: number;
}

export interface SubmissionRound {
  id: string;
  user_id: string;
  topic: string;
  format: string;
  side: Side | null;
  rfd: string | null;
  winner_side: Side | null;
  flow: Record<string, unknown> | null;
  aff_speech: string | null;
  neg_speech: string | null;
  aff_two_speech: string | null;
  first_speech_wpm: number | null;
  second_speech_wpm: number | null;
  average_wpm: number | null;
  wpm_series:
    | WpmPoint[]
    | { aff?: WpmPoint[]; aff_two?: WpmPoint[] }
    | null;
  speech_metrics: Record<
    string,
    {
      duration_seconds?: number | null;
      filler_count?: number | null;
      filler_words?: Record<string, number> | null;
      filler_per_minute?: number | null;
      major_pause_count?: number | null;
    }
  > | null;
  filler_count: number | null;
  filler_per_minute: number | null;
  major_pause_count: number | null;
  created_at: string | null;
}

export interface SubmissionDrill {
  id: string;
  user_id: string;
  drill_type: string;
  prompt: Record<string, unknown> | null;
  response: string | null;
  score: Record<string, unknown> | null;
  numeric_score: number | null;
  duration_seconds: number | null;
  wpm: number | null;
  accuracy: number | null;
  completion: number | null;
  timer_seconds: number | null;
  created_at: string | null;
}

export interface SubmissionRecipient {
  id: string;
  assignment_id: string;
  user_id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface SubmissionAssignment {
  id: string;
  class_id: string;
  title: string;
  type: "drill" | "practice_round" | "case";
  payload: Record<string, unknown>;
  due_at?: string | null;
  created_at?: string | null;
}

export interface SubmissionRecord {
  id: string;
  recipient_id: string;
  user_id: string;
  drill_id?: string | null;
  round_id?: string | null;
  case_review_id?: string | null;
  created_at?: string | null;
}

export interface SubmissionCaseReview {
  id: string;
  user_id: string;
  format: string;
  topic: string;
  side: Side;
  source_text: string;
  score: number;
  category: string;
  summary: string;
  feedback: string;
  created_at: string | null;
}

export interface SubmissionDetailResponse {
  type: "round" | "drill" | "case";
  round: SubmissionRound | null;
  drill: SubmissionDrill | null;
  case_review: SubmissionCaseReview | null;
  recipient: SubmissionRecipient;
  assignment: SubmissionAssignment;
  submission: SubmissionRecord | null;
}
