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
import type { FillerTrendPoint } from "@/lib/progress";

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FillerTrendChart({ data }: { data: FillerTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-slate-100 text-sm text-slate-500"
        style={{ height: 240 }}
      >
        No filler data yet.
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
          allowDecimals={false}
          label={{
            value: "Fillers/min",
            angle: -90,
            position: "insideLeft",
            fill: "#64748b",
            fontSize: 12,
          }}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            name === "fillerPerMinute"
              ? `${Number(value).toFixed(1)} / min`
              : Math.round(value),
            name === "fillerPerMinute" ? "Fillers per minute" : "Filler count",
          ]}
          labelFormatter={(label: string) => shortDate(label)}
        />
        <Line
          type="monotone"
          dataKey="fillerPerMinute"
          stroke="#be123c"
          strokeWidth={2}
          dot={{ r: 3, fill: "#be123c" }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
