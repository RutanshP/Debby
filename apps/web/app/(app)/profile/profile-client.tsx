"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProfile } from "@/lib/profiles";
import { getBrowserSupabase } from "@/lib/supabase";
import { useClasses } from "@/lib/queries/classroom";
import type { Profile } from "@/lib/profiles";

export function ProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const classesQuery = useClasses();

  // Load user profile and email
  useEffect(() => {
    async function loadProfile() {
      try {
        const [profileData, { data: { user } }] = await Promise.all([
          getProfile(),
          getBrowserSupabase().auth.getUser(),
        ]);
        setProfile(profileData);
        setEmail(user?.email ?? null);
      } catch {
        setProfileError("Could not load your profile.");
      } finally {
        setProfileLoading(false);
      }
    }
    void loadProfile();
  }, []);

  const classesLoading = classesQuery.isLoading;
  const classes = classesQuery.data ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-8 text-3xl font-bold text-teal-dark">Profile</h1>

      {profileError && (
        <div role="alert" className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {profileError}
        </div>
      )}

      {profileLoading ? (
        <p className="text-sm text-slate-500">Loading your profile...</p>
      ) : (
        <>
          {/* User Info Card */}
          <section className="mb-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Account Information</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium uppercase text-slate-500">Display Name</p>
                <p className="mt-1 text-base text-slate-900">{profile?.display_name || "Not set"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-500">Email</p>
                <p className="mt-1 text-base text-slate-900">{email || "—"}</p>
              </div>
              <Link
                href="/settings"
                className="inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark"
              >
                Edit display name
              </Link>
            </div>
          </section>

          {/* Classes Section */}
          <section>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Enrolled Classes</h2>

            {classesLoading ? (
              <p className="text-sm text-slate-500">Loading your classes...</p>
            ) : classes.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                You are not enrolled in any classes yet.
              </div>
            ) : (
              <div className="space-y-3">
                {classes.map((cls) => (
                  <Link
                    key={cls.id}
                    href={`/classes?class=${cls.id}`}
                    className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900">{cls.name}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                          <span>
                            <span className="font-medium text-slate-700">Role:</span>{" "}
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                                cls.role === "coach"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {cls.role === "coach" ? "Coach" : "Competitor"}
                            </span>
                          </span>
                          {cls.open_assignments > 0 && (
                            <span>
                              <span className="font-medium text-slate-700">Open assignments:</span>{" "}
                              <span className="font-semibold text-teal-dark">
                                {cls.open_assignments}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        {cls.created_at && (
                          <p>
                            Joined{" "}
                            {new Date(cls.created_at).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
