import { Suspense } from "react";
import { GradebookClient } from "./gradebook-client";

export default function GradebookPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading gradebook...</div>}>
      <GradebookClient />
    </Suspense>
  );
}
