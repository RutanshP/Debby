import { Suspense } from "react";
import { RoundRunner } from "../round-runner";

export default function PracticePage() {
  return (
    <Suspense fallback={null}>
      <RoundRunner />
    </Suspense>
  );
}
