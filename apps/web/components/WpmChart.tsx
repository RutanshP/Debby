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

export interface WpmPoint {
  t: number;
  wpm: number;
}

interface WpmChartProps {
  series: WpmPoint[];
  height?: number;
}

export function WpmChart({ series, height = 240 }: WpmChartProps) {
  if (series.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-slate-100 text-sm text-slate-500"
        style={{ height }}
      >
        No WPM data yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="t"
          tickFormatter={(v: number) => `${Math.round(v)}s`}
          stroke="#64748b"
        />
        <YAxis stroke="#64748b" />
        <Tooltip
          formatter={(value: number) => [`${Math.round(value)} wpm`, "WPM"]}
          labelFormatter={(label: number) => `${Math.round(label)}s`}
        />
        <Line
          type="monotone"
          dataKey="wpm"
          stroke="#0f766e"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
