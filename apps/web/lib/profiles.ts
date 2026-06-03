"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface Profile {
  user_id: string;
  display_name: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface UpdateProfileRequest {
  display_name: string;
}

/** Module-level cache: user_id -> display_name */
const _nameCache = new Map<string, string>();

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export async function getProfile(): Promise<Profile> {
  return apiFetch<Profile>("/api/me/profile");
}

export async function updateProfile(display_name: string): Promise<Profile> {
  return apiFetch<Profile>("/api/me/profile", {
    method: "PUT",
    body: JSON.stringify({ display_name }),
  });
}

async function batchLookup(userIds: string[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  return apiFetch<Record<string, string>>("/api/profiles/lookup", {
    method: "POST",
    body: JSON.stringify({ user_ids: userIds }),
  });
}

/**
 * React hook that batches a POST /api/profiles/lookup for the given userIds,
 * caches results in a module-level map, and returns helpers to resolve names.
 */
export function useProfileNames(userIds: string[]): {
  names: Record<string, string>;
  nameFor: (id: string) => string;
} {
  const [names, setNames] = useState<Record<string, string>>(() => {
    // Seed from the module cache for ids we already know.
    const seed: Record<string, string> = {};
    for (const id of userIds) {
      const cached = _nameCache.get(id);
      if (cached !== undefined) seed[id] = cached;
    }
    return seed;
  });

  // Track which ids we've already kicked off a fetch for to avoid duplicate
  // in-flight requests across re-renders.
  const fetchedRef = useRef(new Set<string>());

  useEffect(() => {
    const missing = userIds.filter(
      (id) => !_nameCache.has(id) && !fetchedRef.current.has(id),
    );
    if (missing.length === 0) return;

    for (const id of missing) fetchedRef.current.add(id);

    batchLookup(missing)
      .then((result) => {
        for (const [id, name] of Object.entries(result)) {
          _nameCache.set(id, name);
        }
        setNames((prev) => ({ ...prev, ...result }));
      })
      .catch(() => {
        // On error, leave names as shortIds — non-fatal.
      });
  }, [userIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function nameFor(id: string): string {
    return names[id] ?? shortId(id);
  }

  return { names, nameFor };
}
