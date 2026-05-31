import { cookies } from "next/headers";
import Link from "next/link";
import type React from "react";
import ReactMarkdown from "react-markdown";
import { getServerSupabase } from "@/lib/supabase";
import { SavedCaseActions } from "./case-actions";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface SavedCase {
  id: string;
  title: string;
  topic: string;
  format: "parli" | "mspdp";
  side: "aff" | "neg";
  content: string;
  created_at: string | null;
}

interface PageProps {
  params: Promise<{ caseId: string }>;
}

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-4 text-2xl font-bold text-teal-800">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-3 mt-6 text-xl font-semibold text-teal-700">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold text-slate-800">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 leading-7 text-slate-700">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-4 list-disc space-y-2 pl-6 text-slate-700">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-4 list-decimal space-y-2 pl-6 text-slate-700">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-7">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
};

function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/library?tab=cases"
        className="mb-4 inline-flex text-sm font-medium text-teal transition hover:text-teal-dark"
      >
        Back to Library
      </Link>
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Saved case not found.
      </div>
    </main>
  );
}

export default async function SavedCasePage({ params }: PageProps) {
  const { caseId } = await params;
  const cookieStore = await Promise.resolve(cookies());
  const supabase = getServerSupabase(cookieStore);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return <NotFound />;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/saved-cases/${caseId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
  } catch {
    return <NotFound />;
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    return <NotFound />;
  }
  if (!res.ok) {
    throw new Error(`Failed to load saved case: ${res.status}`);
  }

  const savedCase = (await res.json()) as SavedCase;

  return (
    <main className="case-builder-page mx-auto max-w-5xl space-y-6 px-4 py-10">
      <header className="case-builder-controls">
        <Link
          href="/library?tab=cases"
          className="mb-4 inline-flex text-sm font-medium text-teal transition hover:text-teal-dark"
        >
          Back to Library
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-teal-dark">
              {savedCase.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {savedCase.format.toUpperCase()} &middot;{" "}
              {savedCase.side === "aff" ? "Affirmative" : "Negative"} &middot;{" "}
              {savedCase.created_at
                ? new Date(savedCase.created_at).toLocaleString()
                : ""}
            </p>
          </div>
          <SavedCaseActions
            id={savedCase.id}
            topic={savedCase.topic}
            side={savedCase.side}
          />
        </div>
      </header>

      <article className="case-print-document rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ReactMarkdown components={markdownComponents}>
          {savedCase.content}
        </ReactMarkdown>
      </article>
    </main>
  );
}
