import { Suspense } from "react";
import { ClassesClient } from "./classes-client";

export const metadata = {
  title: "Classes | Debby",
};

export default function ClassesPage() {
  return (
    <Suspense fallback={null}>
      <ClassesClient />
    </Suspense>
  );
}
