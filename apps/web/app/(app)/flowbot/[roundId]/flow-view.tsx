"use client";

import { FlowSheet, type FlowSheetData } from "@/components/FlowSheet";

interface FlowViewProps {
  flow: FlowSheetData | null | undefined;
}

function isEmptyFlow(flow: FlowSheetData | null | undefined): boolean {
  if (!flow) return true;
  const affEmpty = !flow.aff || flow.aff.length === 0;
  const negEmpty = !flow.neg || flow.neg.length === 0;
  return affEmpty && negEmpty && !flow.ballot;
}

export default function FlowView({ flow }: FlowViewProps) {
  if (isEmptyFlow(flow)) {
    return (
      <div
        data-testid="flow-empty"
        className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500"
      >
        No flow available for this round.
      </div>
    );
  }

  const safeFlow: FlowSheetData = {
    aff: flow!.aff ?? [],
    neg: flow!.neg ?? [],
    ballot: flow!.ballot,
    unrefuted: flow!.unrefuted,
  };

  return <FlowSheet flow={safeFlow} />;
}
