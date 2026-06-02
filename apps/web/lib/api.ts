import { getBrowserSupabase } from "./supabase";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function buildRequest(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await authHeader())) {
    headers.set(k, v);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && typeof parsed.detail === "string") {
        message = parsed.detail;
      }
    } catch {
      // Keep the raw response body when it is not JSON.
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await buildRequest(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiFetchBlob(
  path: string,
  init: RequestInit = {},
): Promise<Blob> {
  const res = await buildRequest(path, init);
  return res.blob();
}

export function apiStreamUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export interface SpeechInsightsResponse {
  summary: {
    headline: string;
    strengths: string[];
    recurring_issues: string[];
    suggested_focus: string;
  };
  rounds_covered: number;
  generated_at: string;
}

export async function getInsights(): Promise<SpeechInsightsResponse | null> {
  const value = await apiFetch<SpeechInsightsResponse | undefined>("/api/insights");
  return value ?? null;
}

export async function refreshInsights(): Promise<SpeechInsightsResponse> {
  return apiFetch<SpeechInsightsResponse>("/api/insights/refresh", { method: "POST" });
}
