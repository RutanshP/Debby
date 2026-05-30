import {
  drillScoreTrend,
  fillerTrend,
  headlineStats,
  type ProgressDrill,
  type ProgressRound,
} from "@/lib/progress";

describe("headlineStats", () => {
  it("counts round speech time and drill practice time", () => {
    const rounds: ProgressRound[] = [
      {
        id: "r1",
        topic: "Topic",
        format: "parli",
        side: "aff",
        winner_side: "aff",
        total_speech_time: "00:02:30",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "r2",
        topic: "Topic 2",
        format: "mspdp",
        side: "neg",
        winner_side: "aff",
        total_speech_time: { minutes: 1, seconds: 30 },
        created_at: "2026-01-02T00:00:00Z",
      },
    ];
    const drills: ProgressDrill[] = [
      {
        id: "d1",
        drill_type: "contention",
        timer_seconds: 60,
        created_at: "2026-01-03T00:00:00Z",
      },
      {
        id: "d2",
        drill_type: "speed",
        duration_seconds: 50,
        score: { duration_seconds: 45 },
        timer_seconds: 120,
        created_at: "2026-01-04T00:00:00Z",
      },
      {
        id: "d3",
        drill_type: "impact",
        prompt: { timer_seconds: 30 },
        created_at: "2026-01-05T00:00:00Z",
      },
    ];

    expect(headlineStats(rounds, drills).totalPracticeMinutes).toBe(6);
  });
});

describe("fillerTrend", () => {
  it("tracks filler words per recorded speech", () => {
    const rounds: ProgressRound[] = [
      {
        id: "r1",
        topic: "Topic",
        format: "parli",
        side: "aff",
        winner_side: "aff",
        speech_metrics: {
          aff: { filler_count: 3 },
          aff_two: { filler_count: 1 },
        },
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "r2",
        topic: "Topic 2",
        format: "parli",
        side: "aff",
        winner_side: "neg",
        filler_count: 1,
        filler_per_minute: 1,
        created_at: "2026-01-02T00:00:00Z",
      },
    ];

    expect(fillerTrend(rounds)).toEqual([
      {
        label: "Aff",
        date: "2026-01-01T00:00:00Z",
        fillerCount: 3,
      },
      {
        label: "Rebuttal",
        date: "2026-01-01T00:00:00Z",
        fillerCount: 1,
      },
      {
        label: "Round",
        date: "2026-01-02T00:00:00Z",
        fillerCount: 1,
      },
    ]);
  });
});

describe("drillScoreTrend", () => {
  it("includes speed drill scores when the backend returns a derived score", () => {
    const drills: ProgressDrill[] = [
      {
        id: "d1",
        drill_type: "speed",
        score: { score: 8, duration_seconds: 42 },
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    expect(drillScoreTrend(drills).speed).toEqual([
      { date: "2026-01-01T00:00:00Z", score: 8 },
    ]);
  });

  it("prefers computed score columns over nested JSON score payloads", () => {
    const drills: ProgressDrill[] = [
      {
        id: "d1",
        drill_type: "impact",
        numeric_score: 9,
        score: { score: 4 },
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    expect(drillScoreTrend(drills).impact).toEqual([
      { date: "2026-01-01T00:00:00Z", score: 9 },
    ]);
  });
});
