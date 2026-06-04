import { Suspense } from "react";
import { ProfileClient } from "./profile-client";

export const metadata = {
  title: "Profile | Debby",
};

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileClient />
    </Suspense>
  );
}
