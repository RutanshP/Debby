"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getProfile, updateProfile } from "@/lib/profiles";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then((profile) => {
        setDisplayName(profile.display_name ?? "");
      })
      .catch(() => {
        setError("Could not load your profile.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!displayName.trim()) {
      setError("Display name cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile(displayName.trim());
      setSaved(true);
    } catch {
      setError("Could not save your display name. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-teal-dark">Settings</h1>

      {loading ? (
        <p className="text-sm text-slate-500">Loading profile...</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <label className={labelClass}>
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setSaved(false);
              }}
              placeholder="How you'll appear to teammates"
              className={fieldClass}
              autoComplete="name"
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {saved ? (
            <p role="status" className="rounded-md bg-teal/10 px-3 py-2 text-sm text-teal-dark">
              Display name saved.
            </p>
          ) : null}

          <button type="submit" disabled={saving} className={primaryButtonClass}>
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      )}
    </main>
  );
}
