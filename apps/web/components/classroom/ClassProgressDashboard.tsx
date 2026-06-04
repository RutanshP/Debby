"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  flattenClassProgress,
  resolveDisplayNames,
  shortId,
  type ClassProgressResponse,
  type StudentProgressData,
} from "@/lib/coachProgress";
import {
  activityHeatmap,
  drillScoreTrend,
  droppedPatterns,
  fillerTrend,
  headlineStats,
  recentRounds,
  weaknessSpotlight,
  winRateBreakdown,
  wpmTrend,
  type ProgressDrill,
  type ProgressRound,
} from "@/lib/progress";
import { HeadlineStatsRow } from "@/components/progress/HeadlineStats";
import { WpmTrendChart } from "@/components/progress/WpmTrendChart";
import { FillerTrendChart } from "@/components/progress/FillerTrendChart";
import { WinRateBreakdownCard } from "@/components/progress/WinRateBreakdown";
import { RecentRoundsList } from "@/components/progress/RecentRoundsList";
import { DrillScoreTrendChart } from "@/components/progress/DrillScoreTrend";
import { WeaknessSpotlight } from "@/components/progress/WeaknessSpotlight";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { DroppedArgumentPatterns } from "@/components/progress/DroppedArgumentPatterns";

const sectionCard = "rounded-lg border border-slate-200 bg-white p-6 shadow-sm";
const sectionTitle = "text-lg font-semibold text-slate-800";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={sectionCard}>
      <h2 className={`${sectionTitle} mb-4`}>{title}</h2>
      {children}
    </section>
  );
}

function ProgressCharts({
  rounds,
  drills,
}: {
  rounds: ProgressRound[];
  drills: ProgressDrill[];
}) {
  if (rounds.length === 0 && drills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <h3 className="text-lg font-semibold text-slate-700">No practice data yet</h3>
        <p className="mt-2 text-sm text-slate-500">
          This student has not completed any rounds or drills yet.
        </p>
      </div>
    );
  }

  const stats = headlineStats(rounds, drills);
  const trend = wpmTrend(rounds);
  const filler = fillerTrend(rounds);
  const breakdown = winRateBreakdown(rounds);
  const recent = recentRounds(rounds, 5);
  const drillTrend = drillScoreTrend(drills);
  const weakness = weaknessSpotlight(rounds);
  const heatmap = activityHeatmap(rounds, drills);
  const dropped = droppedPatterns(rounds);

  return (
    <div className="space-y-6">
      <HeadlineStatsRow stats={stats} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="WPM over time">
          <WpmTrendChart data={trend} />
        </Section>
        <Section title="Delivery issues over time">
          <FillerTrendChart data={filler} />
        </Section>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Win rate">
          <WinRateBreakdownCard data={breakdown} />
        </Section>
        <Section title="Focus area">
          <WeaknessSpotlight weakness={weakness} />
        </Section>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Drill scores">
          <DrillScoreTrendChart trend={drillTrend} />
        </Section>
        <Section title="Activity">
          <ActivityHeatmap days={heatmap} />
        </Section>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Recent rounds">
          <RecentRoundsList rounds={recent} />
        </Section>
        <Section title="Dropped arguments">
          <DroppedArgumentPatterns patterns={dropped} />
        </Section>
      </div>
    </div>
  );
}

export function ClassProgressDashboard({ classId }: { classId: string }) {
  const [data, setData] = useState<ClassProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | "all">("all");
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<ClassProgressResponse>(
          `/api/classes/${classId}/progress`,
        );
        if (ignore) return;
        setData(result);
        // Resolve display names
        const ids = result.students.map((s) => s.user_id);
        const resolved = await resolveDisplayNames(ids, (url, opts) =>
          apiFetch(url, opts),
        );
        if (!ignore) setNameMap(resolved);
      } catch (err) {
        if (!ignore)
          setError(err instanceof Error ? err.message : "Failed to load progress");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [classId]);

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        Loading progress...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
        {error}
      </div>
    );
  }

  if (!data || data.students.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <h3 className="text-lg font-semibold text-slate-700">No competitors yet</h3>
        <p className="mt-2 text-sm text-slate-500">
          Students who join with the class code will appear here.
        </p>
      </div>
    );
  }

  const { rounds: allRounds, drills: allDrills } = flattenClassProgress(data.students);

  const activeStudent: StudentProgressData | null =
    selectedUserId === "all"
      ? null
      : (data.students.find((s) => s.user_id === selectedUserId) ?? null);

  const displayRounds = activeStudent ? activeStudent.rounds : allRounds;
  const displayDrills = activeStudent ? activeStudent.drills : allDrills;

  return (
    <div className="flex flex-col gap-6">
      {/* Student selector */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="selector-all"
          onClick={() => setSelectedUserId("all")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            selectedUserId === "all"
              ? "bg-teal text-white"
              : "bg-slate-100 text-slate-700 hover:bg-teal/10 hover:text-teal-dark"
          }`}
        >
          All students
        </button>
        {data.students.map((student) => {
          const name = nameMap.get(student.user_id) ?? shortId(student.user_id);
          const active = selectedUserId === student.user_id;
          return (
            <button
              key={student.user_id}
              type="button"
              data-testid={`selector-${student.user_id}`}
              onClick={() => setSelectedUserId(student.user_id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-teal text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-teal/10 hover:text-teal-dark"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Charts */}
      <ProgressCharts rounds={displayRounds} drills={displayDrills} />
    </div>
  );
}
