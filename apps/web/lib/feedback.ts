import { apiFetch } from "@/lib/api";

export interface SubmissionFeedback {
  id: string;
  recipient_id: string;
  coach_id?: string | null;
  grade?: number | null;
  feedback?: string | null;
  returned: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface UpsertFeedbackRequest {
  grade?: number | null;
  feedback?: string | null;
  returned?: boolean | null;
}

export async function getFeedback(
  recipientId: string,
): Promise<SubmissionFeedback | null> {
  return apiFetch<SubmissionFeedback | null>(
    `/api/recipients/${recipientId}/feedback`,
  );
}

export async function upsertFeedback(
  recipientId: string,
  req: UpsertFeedbackRequest,
): Promise<SubmissionFeedback> {
  return apiFetch<SubmissionFeedback>(
    `/api/recipients/${recipientId}/feedback`,
    {
      method: "PUT",
      body: JSON.stringify(req),
    },
  );
}
