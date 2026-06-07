import { Suspense } from "react";
import { CalendarClient } from "./calendar-client";

export const metadata = {
  title: "Calendar | Debby",
};

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarClient />
    </Suspense>
  );
}
