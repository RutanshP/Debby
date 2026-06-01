import { Suspense } from "react";
import { DrillsClient } from "./drills-client";

export const metadata = {
  title: "Drills | Debby",
};

export default function DrillsPage() {
  return (
    <Suspense fallback={null}>
      <DrillsClient />
    </Suspense>
  );
}
