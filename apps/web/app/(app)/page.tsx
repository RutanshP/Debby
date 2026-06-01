import { Suspense } from "react";
import { RoundRunner } from "./round-runner";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <RoundRunner />
    </Suspense>
  );
}
