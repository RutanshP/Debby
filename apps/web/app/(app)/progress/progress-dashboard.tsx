"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import type { SpeechInsightsResponse } from "@/lib/api";
import { HeadlineStatsRow } from "@/components/progress/HeadlineStats";
import { WpmTrendChart } from "@/components/progress/WpmTrendChart";
import { FillerTrendChart } from "@/components/progress/FillerTrendChart";
import { WinRateBreakdownCard } from "@/components/progress/WinRateBreakdown";
import { RecentRoundsList } from "@/components/progress/RecentRoundsList";
import { DrillScoreTrendChart } from "@/components/progress/DrillScoreTrend";
import { WeaknessSpotlight } from "@/components/progress/WeaknessSpotlight";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { DroppedArgumentPatterns } from "@/components/progress/DroppedArgumentPatterns";
import { SpeechInsightsCard } from "@/components/progress/SpeechInsightsCard";
import { withClassContext } from "@/lib/classroom";

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

export function ProgressDashboard({
  rounds,
  drills,
  initialInsights,
}: {
  rounds: ProgressRound[];
  drills: ProgressDrill[];
  initialInsights: SpeechInsightsResponse | null;
}) {
  const searchParams = useSearchParams();
  const classId = searchParams.get("class");

  if (rounds.length === 0 && drills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <h2 className="text-lg font-semibold text-slate-700">
          No practice data yet
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Run your first round to start seeing your progress here.
        </p>
        <Link
          href={withClassContext("/practice", classId)}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark"
        >
          Start a round
        </Link>
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

      <Section title="Speech insights">
        <SpeechInsightsCard initial={initialInsights} />
      </Section>

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
