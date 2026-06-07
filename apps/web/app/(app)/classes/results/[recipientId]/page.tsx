import { cookies } from "next/headers";
import type { SubmissionDetailResponse } from "@/lib/classSubmission";
import type { SubmissionFeedback } from "@/lib/feedback";
import { getServerSupabase } from "@/lib/supabase";
import {
  SubmissionDetailView,
  SubmissionNotFound,
} from "@/components/classroom/SubmissionDetailView";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface PageProps {
  params: Promise<{ recipientId: string }>;
  searchParams: Promise<{ class?: string }>;
}

async function fetchOptionalFeedback(
  recipientId: string,
  accessToken: string,
): Promise<SubmissionFeedback | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/recipients/${recipientId}/feedback`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to load feedback: ${response.status}`);
    }
    return (await response.json()) as SubmissionFeedback | null;
  } catch {
    return null;
  }
}

export default async function StudentSubmissionPage({
  params,
  searchParams,
}: PageProps) {
  const { recipientId } = await params;
  const { class: classId } = await searchParams;

  const backHref = classId ? `/classes?class=${classId}&tab=results` : "/classes";

  const cookieStore = await Promise.resolve(cookies());
  const supabase = getServerSupabase(cookieStore);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return <SubmissionNotFound back={backHref} />;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/recipients/${recipientId}/submission`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
  } catch {
    return <SubmissionNotFound back={backHref} />;
  }

  if (res.status === 404 || res.status === 401 || res.status === 403) {
    return <SubmissionNotFound back={backHref} />;
  }
  if (!res.ok) {
    throw new Error(`Failed to load submission: ${res.status}`);
  }

  const data = (await res.json()) as SubmissionDetailResponse;
  const feedback = await fetchOptionalFeedback(recipientId, session.access_token);

  return (
    <SubmissionDetailView
      data={data}
      backHref={backHref}
      headingDetail="Your results"
      coachFeedback={feedback}
    />
  );
}
