"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WpmTrendPoint } from "@/lib/progress";

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WpmTrendChart({ data }: { data: WpmTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-slate-100 text-sm text-slate-500"
        style={{ height: 240 }}
      >
        No WPM data yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 32, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          stroke="#64748b"
          label={{
            value: "Round date",
            position: "insideBottom",
            offset: -18,
            fill: "#64748b",
            fontSize: 12,
          }}
        />
        <YAxis
          stroke="#64748b"
          label={{
            value: "Avg WPM",
            angle: -90,
            position: "insideLeft",
            fill: "#64748b",
            fontSize: 12,
          }}
        />
        <Tooltip
          formatter={(value: number) => [`${Math.round(value)} wpm`, "WPM"]}
          labelFormatter={(label: string) => shortDate(label)}
        />
        <Line
          type="monotone"
          dataKey="avgWpm"
          stroke="#0f766e"
          strokeWidth={2}
          dot={{ r: 3, fill: "#0f766e" }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
