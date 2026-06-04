"use client";

import { useMemo, useState } from "react";
import { upsertFeedback } from "@/lib/feedback";
import { useProfileNames } from "@/lib/profiles";
import {
  classroomKeys,
  useClassDetail,
  useQueryClient,
} from "@/lib/queries/classroom";
import { isCoachAssignmentSummary } from "@/lib/classroom";
import { GradeCell } from "./GradeCell";

interface GradebookDashboardProps {
  classId: string;
  embedded?: boolean;
}

export function GradebookDashboard({
  classId,
  embedded = false,
}: GradebookDashboardProps) {
  const classDetailQuery = useClassDetail(classId);
  const queryClient = useQueryClient();
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const classDetail = classDetailQuery.data;
  const isCoach = classDetail?.role === "coach";

  const coachAssignments = useMemo(() => {
    if (!classDetail || !isCoach) return [];
    return classDetail.assignments.filter(isCoachAssignmentSummary);
  }, [classDetail, isCoach]);

  const competitors = useMemo(() => {
    if (!classDetail) return [];
    return classDetail.roster.filter((member) => member.role === "competitor");
  }, [classDetail]);

  const { nameFor } = useProfileNames(
    competitors.map((member) => member.user_id),
  );

  const recipientMatrix = useMemo(() => {
    const matrix: (string | null)[][] = competitors.map(() =>
      coachAssignments.map(() => null),
    );

    coachAssignments.forEach((summary, assignmentIdx) => {
      summary.recipients.forEach((recipient) => {
        const competitorIdx = competitors.findIndex(
          (competitor) => competitor.user_id === recipient.user_id,
        );
        if (competitorIdx >= 0) {
          matrix[competitorIdx][assignmentIdx] = recipient.id;
        }
      });
    });

    return matrix;
  }, [competitors, coachAssignments]);

  async function handleGradeSave(
    recipientId: string,
    grade: number | null,
    feedback: string | null,
  ) {
    setSavingCell(recipientId);
    try {
      await upsertFeedback(recipientId, {
        grade,
        feedback: feedback?.trim() || null,
      });
      await queryClient.invalidateQueries({
        queryKey: classroomKeys.detail(classId),
      });
      await queryClient.invalidateQueries({
        queryKey: classroomKeys.feedback(recipientId),
      });
      setEditingCell(null);
    } finally {
      setSavingCell(null);
    }
  }

  const wrapperClass = embedded ? "flex flex-col gap-4" : "mx-auto max-w-7xl p-6";

  if (!classDetail) {
    return (
      <section className={wrapperClass}>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Loading class details...
        </div>
      </section>
    );
  }

  if (!isCoach) {
    return (
      <section className={wrapperClass}>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm text-slate-600">
            Gradebook is available for coaches only.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={wrapperClass}>
      <header className={embedded ? "flex flex-col gap-1" : "mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"}>
        <div>
          <h2 className={embedded ? "text-xl font-semibold text-slate-900" : "text-3xl font-bold text-teal-dark"}>
            Gradebook
          </h2>
          {!embedded && (
            <p className="mt-1 text-sm text-slate-600">
              {classDetail.class_room.name}
            </p>
          )}
        </div>
      </header>

      {competitors.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm text-slate-600">
            No competitors in this class yet.
          </p>
        </div>
      ) : coachAssignments.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm text-slate-600">
            No assignments created yet. Create an assignment to start grading.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-900">
                  Student
                </th>
                {coachAssignments.map((summary, idx) => (
                  <th
                    key={`header-${idx}`}
                    className="border-l border-slate-200 px-3 py-3 text-center font-semibold text-slate-900"
                  >
                    <div className="max-w-[120px] truncate text-xs font-medium">
                      {summary.assignment.title}
                    </div>
                  </th>
                ))}
                <th className="border-l border-slate-200 bg-teal/5 px-3 py-3 text-center font-semibold text-slate-900">
                  Avg
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {competitors.map((competitor, competitorIdx) => (
                <tr key={`row-${competitor.user_id}`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-3 font-medium text-slate-900">
                    {nameFor(competitor.user_id)}
                  </td>
                  {recipientMatrix[competitorIdx].map((recipientId, assignmentIdx) => (
                    <td
                      key={`cell-${competitorIdx}-${assignmentIdx}`}
                      className="border-l border-slate-200 px-3 py-2 text-center"
                    >
                      <GradeCell
                        recipientId={recipientId}
                        isEditing={editingCell === recipientId}
                        isSaving={savingCell === recipientId}
                        onEdit={() => setEditingCell(recipientId)}
                        onCancel={() => setEditingCell(null)}
                        onSave={handleGradeSave}
                      />
                    </td>
                  ))}
                  <td className="border-l border-slate-200 bg-teal/5 px-3 py-2 text-center">
                    <span className="text-slate-400">-</span>
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-slate-900">
                  Avg
                </td>
                {coachAssignments.map((_, idx) => (
                  <td
                    key={`footer-${idx}`}
                    className="border-l border-slate-200 px-3 py-3 text-center"
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="text-teal-dark">-</div>
                      <div className="text-xs text-slate-600">-%</div>
                    </div>
                  </td>
                ))}
                <td className="border-l border-slate-200 bg-teal/5 px-3 py-3 text-center text-teal-dark">
                  -
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
