"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
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
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 32, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="label"
          stroke="#64748b"
          label={{
            value: "Speech",
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
            value: "Filler words",
            angle: -90,
            position: "insideLeft",
            fill: "#64748b",
            fontSize: 12,
          }}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            Math.round(value),
            name === "issueCount" ? "Delivery issues" : name,
          ]}
          labelFormatter={(_label: unknown, payload: Array<{ payload?: unknown }>) => {
            const item = payload?.[0]?.payload as FillerTrendPoint | undefined;
            return item
              ? `${shortDate(item.date)} · ${item.fillerCount} fillers + ${item.majorPauseCount} pauses`
              : "";
          }}
        />
        <Bar
          dataKey="issueCount"
          name="Delivery issues"
          fill="#be123c"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
