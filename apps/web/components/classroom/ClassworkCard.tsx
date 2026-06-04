"use client";

import Link from "next/link";
import { assignmentTypeLabel, formatDate, statusLabel, type AssignmentRecipientDetail } from "@/lib/classroom";

interface ClassworkCardProps {
  item: AssignmentRecipientDetail;
  href: string;
}

const STATUS_PILL: Record<string, string> = {
  completed: "bg-teal/10 text-teal-dark",
  in_progress: "bg-amber-50 text-amber-700",
  assigned: "bg-slate-100 text-slate-600",
};

function TypeIcon({ type }: { type: string }) {
  const isDrill = type === "drill";
  return (
    <div
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${
        isDrill ? "bg-teal" : "bg-teal-dark"
      }`}
    >
      {isDrill ? (
        /* microphone icon */
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
          <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
        </svg>
      ) : (
        /* chat-bubble icon */
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M4.804 21.644A6.707 6.707 0 0 0 6 21.75a6.721 6.721 0 0 0 3.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 0 1-.814 1.686.75.75 0 0 0 .44 1.223Z" clipRule="evenodd" />
        </svg>
      )}
    </div>
  );
}

export function ClassworkCard({ item, href }: ClassworkCardProps) {
  const { assignment, recipient } = item;
  const pillClass = STATUS_PILL[recipient.status] ?? STATUS_PILL.assigned;
  const isComplete = recipient.status === "completed";

  return (
    <article className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <TypeIcon type={assignment.type} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{assignment.title}</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pillClass}`}>
            {statusLabel(recipient.status)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {assignmentTypeLabel(assignment.type)} &middot; Due {formatDate(assignment.due_at)}
        </p>
      </div>

      {isComplete ? (
        <span className="shrink-0 text-sm font-semibold text-teal-dark">Done</span>
      ) : (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-dark"
        >
          Start
        </Link>
      )}
    </article>
  );
}
