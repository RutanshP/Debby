// Pure aggregator helpers for the Progress dashboard.
// Inputs are the shapes returned by GET /api/rounds and GET /api/drills.

export type Side = "aff" | "neg";
export type Format = "parli" | "mspdp";
export type DrillType = "rebuttal" | "speed" | "impact" | "contention";

export interface ProgressRound {
  id: string;
  topic: string;
  format: Format | string;
  side: Side | null;
  winner_side: Side | null;
  flow?: {
    ballot?: { winner?: Side | string | null } | string | null;
    dropped?: Array<{ tag?: string; summary?: string } | string> | null;
    recommended_drills?: string[] | null;
  } | null;
  average_wpm?: number | null;
  first_speech_wpm?: number | null;
  second_speech_wpm?: number | null;
  total_speech_time?: string | null; // Postgres interval, ISO-8601, or "HH:MM:SS"
  created_at: string;
}

export interface ProgressDrill {
  id: string;
  drill_type: DrillType | string;
  score?: { score?: number | null } | null;
  timer_seconds?: number | null;
  created_at?: string | null;
}

export interface HeadlineStats {
  totalRounds: number;
  winRate: number; // 0..100, one decimal
  avgWpm: number | null;
  totalPracticeMinutes: number;
}

export interface WpmTrendPoint {
  date: string; // ISO
  avgWpm: number;
}

export interface WinRateBreakdown {
  bySide: { aff: { rounds: number; winPct: number }; neg: { rounds: number; winPct: number } };
  byFormat: { parli: { rounds: number; winPct: number }; mspdp: { rounds: number; winPct: number } };
}

export interface DrillTrendPoint {
  date: string;
  score: number;
}

export type DrillScoreTrend = Record<DrillType, DrillTrendPoint[]>;

export interface ActivityDay {
  date: string; // yyyy-mm-dd
  count: number;
}

export interface DroppedPattern {
  tag: string;
  count: number;
}

const DRILL_TYPES: DrillType[] = ["rebuttal", "speed", "impact", "contention"];

function resolvedWinner(r: ProgressRound): Side | null {
  if (r.winner_side === "aff" || r.winner_side === "neg") return r.winner_side;
  const ballot = r.flow?.ballot;
  if (ballot && typeof ballot === "object") {
    const w = ballot.winner;
    if (w === "aff" || w === "neg") return w;
  }
  return null;
}

function userWon(r: ProgressRound): boolean | null {
  const w = resolvedWinner(r);
  if (!w || !r.side) return null;
  return w === r.side;
}

// Best-effort parser for either an ISO-8601 duration ("PT1M30S") or a
// "HH:MM:SS"/"MM:SS" string. Returns seconds.
function parseIntervalSeconds(value: string | null | undefined): number {
  if (!value) return 0;
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value);
  if (iso) {
    const [, h, m, s] = iso;
    return (parseInt(h ?? "0") * 3600) + (parseInt(m ?? "0") * 60) + parseFloat(s ?? "0");
  }
  const hms = value.split(":").map((p) => parseFloat(p));
  if (hms.every((n) => !Number.isNaN(n))) {
    if (hms.length === 3) return hms[0] * 3600 + hms[1] * 60 + hms[2];
    if (hms.length === 2) return hms[0] * 60 + hms[1];
    if (hms.length === 1) return hms[0];
  }
  return 0;
}

export function headlineStats(
  rounds: ProgressRound[],
  drills: ProgressDrill[],
): HeadlineStats {
  const totalRounds = rounds.length;
  const judged = rounds.filter((r) => userWon(r) !== null);
  const wins = judged.filter((r) => userWon(r) === true).length;
  const winRate = judged.length > 0 ? Math.round((wins / judged.length) * 1000) / 10 : 0;

  const wpms = rounds
    .map((r) => r.average_wpm)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const avgWpm = wpms.length > 0 ? Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length) : null;

  const roundSeconds = rounds.reduce((sum, r) => sum + parseIntervalSeconds(r.total_speech_time), 0);
  const drillSeconds = drills.reduce((sum, d) => sum + (d.timer_seconds ?? 0), 0);
  const totalPracticeMinutes = Math.round((roundSeconds + drillSeconds) / 60);

  return { totalRounds, winRate, avgWpm, totalPracticeMinutes };
}

export function wpmTrend(rounds: ProgressRound[]): WpmTrendPoint[] {
  return [...rounds]
    .filter((r) => typeof r.average_wpm === "number" && (r.average_wpm ?? 0) > 0)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((r) => ({ date: r.created_at, avgWpm: r.average_wpm as number }));
}

export function winRateBreakdown(rounds: ProgressRound[]): WinRateBreakdown {
  const bucket = (filter: (r: ProgressRound) => boolean) => {
    const subset = rounds.filter(filter);
    const judged = subset.filter((r) => userWon(r) !== null);
    const wins = judged.filter((r) => userWon(r) === true).length;
    const winPct = judged.length > 0 ? Math.round((wins / judged.length) * 1000) / 10 : 0;
    return { rounds: subset.length, winPct };
  };

  return {
    bySide: {
      aff: bucket((r) => r.side === "aff"),
      neg: bucket((r) => r.side === "neg"),
    },
    byFormat: {
      parli: bucket((r) => r.format === "parli"),
      mspdp: bucket((r) => r.format === "mspdp"),
    },
  };
}

export function drillScoreTrend(drills: ProgressDrill[]): DrillScoreTrend {
  const out: DrillScoreTrend = {
    rebuttal: [],
    speed: [],
    impact: [],
    contention: [],
  };
  const sorted = [...drills].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });
  for (const d of sorted) {
    if (!DRILL_TYPES.includes(d.drill_type as DrillType)) continue;
    const score = d.score?.score;
    if (typeof score !== "number") continue;
    out[d.drill_type as DrillType].push({
      date: d.created_at ?? "",
      score,
    });
  }
  return out;
}

const WEAKNESS_LABEL: Record<string, { label: string; href: string }> = {
  rebuttal: { label: "Rebuttal Speech", href: "/drills" },
  impact: { label: "Impact Extension", href: "/drills" },
  contentions: { label: "Contention Storm", href: "/drills" },
  contention: { label: "Contention Storm", href: "/drills" },
  speed: { label: "Speed Reading", href: "/drills" },
};

export interface Weakness {
  drillKey: string;
  label: string;
  href: string;
  count: number;
}

export function weaknessSpotlight(rounds: ProgressRound[]): Weakness | null {
  const recent = [...rounds]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);
  const counts = new Map<string, number>();
  for (const r of recent) {
    for (const d of r.flow?.recommended_drills ?? []) {
      const key = String(d).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  const [key, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const meta = WEAKNESS_LABEL[key] ?? { label: key, href: "/drills" };
  return { drillKey: key, label: meta.label, href: meta.href, count };
}

export function activityHeatmap(
  rounds: ProgressRound[],
  drills: ProgressDrill[],
  weeks: number = 12,
  today: Date = new Date(),
): ActivityDay[] {
  const days = weeks * 7;
  const counts = new Map<string, number>();
  const bump = (iso: string | null | undefined) => {
    if (!iso) return;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  rounds.forEach((r) => bump(r.created_at));
  drills.forEach((d) => bump(d.created_at));

  const out: ActivityDay[] = [];
  const start = new Date(today);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export function droppedPatterns(rounds: ProgressRound[], top: number = 5): DroppedPattern[] {
  const counts = new Map<string, number>();
  for (const r of rounds) {
    for (const d of r.flow?.dropped ?? []) {
      const tag =
        typeof d === "string"
          ? d
          : (d?.tag ?? d?.summary ?? "").toString();
      const cleaned = tag.trim();
      if (!cleaned) continue;
      counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([tag, count]) => ({ tag, count }));
}

export function recentRounds(rounds: ProgressRound[], n: number = 5): ProgressRound[] {
  return [...rounds]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, n);
}
