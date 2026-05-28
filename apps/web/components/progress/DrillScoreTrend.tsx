"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DrillScoreTrend, DrillType } from "@/lib/progress";

const SERIES: { key: DrillType; label: string; color: string }[] = [
  { key: "rebuttal", label: "Rebuttal", color: "#0f766e" },
  { key: "impact", label: "Impact", color: "#b45309" },
  { key: "contention", label: "Contention", color: "#1d4ed8" },
  { key: "speed", label: "Speed", color: "#9333ea" },
];

interface Row {
  index: number;
  rebuttal?: number;
  impact?: number;
  contention?: number;
  speed?: number;
}

export function DrillScoreTrendChart({ trend }: { trend: DrillScoreTrend }) {
  // Merge per-drill-type series into a row-per-attempt index. Each drill type
  // gets an independent x-axis position so we don't try to align by date.
  const maxLen = Math.max(...SERIES.map((s) => trend[s.key].length), 0);
  if (maxLen === 0) {
    return (
      <div className="flex items-center justify-center rounded-md bg-slate-100 py-12 text-sm text-slate-500">
        No drill scores yet.
      </div>
    );
  }
  const rows: Row[] = [];
  for (let i = 0; i < maxLen; i++) {
    const row: Row = { index: i + 1 };
    for (const s of SERIES) {
      const p = trend[s.key][i];
      if (p) row[s.key] = p.score;
    }
    rows.push(row);
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="index"
          stroke="#64748b"
          label={{
            value: "Attempt",
            position: "insideBottom",
            offset: -10,
            fill: "#64748b",
            fontSize: 12,
          }}
        />
        <YAxis domain={[0, 10]} stroke="#64748b" />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
